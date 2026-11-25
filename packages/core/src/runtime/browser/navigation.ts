/**
 * The Navigation API, end to end: which navigations are the runtime's, how each gets its payload, and what
 * the browser is told about how it went.
 *
 * Every same-document navigation is answered from one place — the `navigate` listener — whether it came from
 * a link, a `GET` form, `router.push`, Back or Reload. The URL, the history entry and the cancellation are
 * the browser's; this file fetches the payload, hands it to React and waits for the commit.
 */
import { isControlDigest, parseRedirectDigest } from '../control.js';
import type { NavigationOutcome } from '../navigation.js';
import { canSoftNavigate, documentNavigation, loadDocument, reloadOnceForLateNotFound, settle } from './document.js';
import { discard, discardPrepared, prepare, type PageResource } from './page-resource.js';
import { committedAttempt, createAttempt, pendingAttempt, schedule, type AttemptOptions } from './render-attempt.js';
import { cancelElementWatches, jumpToAnchor, rememberCurrentScroll, resetFocus, scrollPointFor, scrollToPoint, scrollToTop } from './scroll.js';

/** The part of a URL a payload is rendered for: the fragment never reaches the server. */
const documentPart = (url: URL): string => url.pathname + url.search;

// ── Router requests ──────────────────────────────────────────────────────────────────────────────────────
//
// The imperative actions behind `useNavigation().router`. Each one only *asks*: the browser turns it into a
// `navigate` event, which is where the listener below answers it — so a `router.push` and a link click reach
// the same code by the same route. A request rides its event as `info`, and carries the caller's promise
// through the fetch and the commit.

const requestMark = Symbol('rsvhono:navigation-request');

type NavigationRequest = {
  mark: typeof requestMark;
  /** Bumped each time the request follows a redirect, so an earlier leg's ending cannot settle a later one. */
  hop: number;
  done: boolean;
  /** A fragment jump: the browser performs it alone, and its `finished` is the only signal there is. */
  browserOnly: boolean;
  promise: Promise<NavigationOutcome>;
  resolve: (outcome: NavigationOutcome) => void;
  reject: (error: unknown) => void;
};

let activeRequest: NavigationRequest | undefined;

/** Settles a request once; later endings of the same request are ignored. */
function close(request: NavigationRequest | undefined, settle: (request: NavigationRequest) => void): void {
  if (!request || request.done) return;
  request.done = true;
  settle(request);
  if (activeRequest === request) activeRequest = undefined;
}

const finishRequest = (request: NavigationRequest | undefined, outcome: NavigationOutcome): void => close(request, (r) => r.resolve(outcome));
const rejectRequest = (request: NavigationRequest | undefined, error: unknown): void => close(request, (r) => r.reject(error));

function newRequest(): NavigationRequest {
  const { promise, resolve, reject } = Promise.withResolvers<NavigationOutcome>();
  // A caller that does not await `router.push()` must not turn a superseded navigation into an unhandled rejection.
  void promise.catch(() => {});
  return { mark: requestMark, hop: 0, done: false, browserOnly: false, promise, resolve, reject };
}

const requestOf = (event: NavigateEvent): NavigationRequest | undefined => {
  const info = event.info as NavigationRequest | undefined;
  return info?.mark === requestMark ? info : undefined;
};

const rendered = (): NavigationOutcome => ({ kind: 'rendered', url: new URL(location.href) });
const superseded = (by = 'Navigation superseded'): DOMException => new DOMException(by, 'AbortError');
const isSuperseded = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

function ask(run: (request: NavigationRequest) => NavigationResult, request = newRequest()): Promise<NavigationOutcome> {
  const hop = request.hop;
  try {
    const result = run(request);
    settle(result);
    void result.finished?.then(
      () => {
        if (request.hop === hop && request.browserOnly) finishRequest(request, rendered());
      },
      (error: unknown) => {
        if (request.hop === hop) rejectRequest(request, error);
      },
    );
  } catch (error) {
    rejectRequest(request, error);
  }
  return request.promise;
}

/** Below the Navigation API every navigation is a document load, which a server-rendered app answers correctly. */
function documentOnly(go: () => void): Promise<NavigationOutcome> {
  go();
  return Promise.resolve({ kind: 'document-navigation' });
}

function navigate(href: string, history: 'push' | 'replace', request?: NavigationRequest): Promise<NavigationOutcome> {
  if (!canSoftNavigate) return documentOnly(() => (history === 'replace' ? window.location.replace(href) : window.location.assign(href)));
  return ask((info) => navigation.navigate(href, { history, info }), request);
}

export const push = (href: string): Promise<NavigationOutcome> => navigate(href, 'push');
export const replace = (href: string): Promise<NavigationOutcome> => navigate(href, 'replace');

export function back(): Promise<NavigationOutcome> {
  if (!canSoftNavigate) return documentOnly(() => window.history.back());
  if (!navigation.canGoBack) return Promise.resolve({ kind: 'no-op' });
  return ask((info) => navigation.back({ info }));
}

export function forward(): Promise<NavigationOutcome> {
  if (!canSoftNavigate) return documentOnly(() => window.history.forward());
  if (!navigation.canGoForward) return Promise.resolve({ kind: 'no-op' });
  return ask((info) => navigation.forward({ info }));
}

export function refresh(): Promise<NavigationOutcome> {
  if (!canSoftNavigate) return documentOnly(() => window.location.reload());
  return ask((info) => navigation.reload({ info }));
}

/**
 * Leaves for a new document — see {@link loadDocument} — and tells whoever is awaiting a router call that
 * this is how it ended.
 */
export function leave(href?: string, options?: { replace?: boolean }): void {
  finishRequest(activeRequest, { kind: 'document-navigation' });
  loadDocument(href, options);
}

/** A server action's reply is taking the screen: the navigation a caller was awaiting will not be what is shown. */
export function supersedeActiveRequest(): void {
  rejectRequest(activeRequest, superseded('Navigation superseded by server action'));
}

/**
 * Turns a control-signal digest — how `redirect()` / `notFound()` reach the browser — into a real
 * navigation. Returns false for anything else, so callers fall through to their own handling.
 *
 * `hard` forces a full document load, for signals that surfaced *through React*: it unmounts the root on
 * an uncaught error, leaving no live tree to soft-navigate with.
 *
 * A redirect is followed *replacing* the entry that raised it, the way a 30x replaces the URL that answered
 * with one. `history` lets the action-reply paths that must not — the fetch catch, and a digest surfacing
 * through React during the reply's render — keep the push they have always had. `notFound()` has nowhere to
 * go but a reload, and a reload is its own entry already.
 */
export function handleControlDigest(
  error: unknown,
  { hard = false, history = 'replace' }: { hard?: boolean; history?: 'push' | 'replace' } = {},
): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (!isControlDigest(digest)) return false;
  const redirect = parseRedirectDigest(digest);
  if (!redirect) {
    reloadOnceForLateNotFound();
  } else if (hard) {
    // The URL is resolved first: a malformed location then throws here, before any navigation is asked for.
    // Replacing is what keeps the URL that raised the redirect from becoming an entry Back bounces through.
    leave(new URL(redirect.location, window.location.href).href, { replace: history === 'replace' });
  } else {
    void navigate(redirect.location, history);
  }
  return true;
}

// ── Showing a payload ────────────────────────────────────────────────────────────────────────────────────

/**
 * Puts `resource` on screen. Resolves `true` once React has **committed** it — not when its root arrives, and
 * not when the update is scheduled — and `false` when the payload turned out to be a redirect or a control
 * signal, which is then already being followed.
 *
 * Throws an `AbortError` when the resource lost the screen before it got there: cancelled while it was still
 * being fetched, or scheduled and then replaced by another render. Anything else thrown is a real failure.
 */
async function show(resource: PageResource, options: AttemptOptions, request?: NavigationRequest): Promise<boolean> {
  let payload;
  try {
    payload = await resource.rootReady;
  } catch (error) {
    if (resource.controller.signal.aborted) throw superseded();
    discard(resource);
    if (handleControlDigest(error)) return false;
    throw error;
  }
  // Checked again after the await: the read may have resolved in the same turn it was cancelled in, and
  // showing it would repaint a page the visitor has left.
  if (resource.controller.signal.aborted) throw superseded();

  if (payload.redirect) {
    discard(resource);
    // Replacing for the same reason as {@link handleControlDigest}: the URL whose payload carried the
    // redirect is the entry being left, and a push would make Back bounce through it into the same redirect.
    if (request) request.hop++;
    void navigate(payload.redirect, 'replace', request);
    return false;
  }

  const outcome = await schedule(createAttempt(resource, payload, documentPart(resource.url), options));
  if (outcome.kind === 'failed') throw outcome.error;
  if (outcome.kind === 'superseded') throw superseded();
  return true;
}

/**
 * {@link show}, as the body of a navigation handler: what it resolves or rejects with is what the browser
 * reports as `navigation.finished`, and the router call that started the navigation is settled alongside.
 *
 * Losing the screen is not this navigation failing, so it is not reported as one — but neither does the
 * handler return before *something* has committed: it waits for whatever took over.
 */
async function perform(event: NavigateEvent, resource: PageResource, afterCommit?: () => void): Promise<void> {
  const request = requestOf(event);
  const hop = request?.hop;
  try {
    const shown = await show(resource, { afterCommit }, request);
    if (shown && request?.hop === hop && !event.signal.aborted) finishRequest(request, rendered());
  } catch (error) {
    rejectRequest(request, error);
    if (isSuperseded(error)) {
      await pendingAttempt()?.completion;
      return;
    }
    // The root this would have rendered into is gone, or the server answered with something that is not a
    // payload. Either way the document load asks the server the same question and shows its answer.
    leave();
  }
}

/** Re-reads the page at the current URL in place — a dev server's edit to a server component. */
export function refetch(): void {
  discardPrepared();
  void show(prepare(location.href), {}).catch((error: unknown) => {
    if (!isSuperseded(error)) leave();
  });
}

// ── The navigate listener ────────────────────────────────────────────────────────────────────────────────

/**
 * Whether a destination names a file rather than a page. `public/`, `/_static` and an endpoint route that
 * serves a document (`/llms.txt`, `/sitemap.xml`) answer an RSC fetch with the file itself, not a flight
 * payload — so intercepting one buys nothing: the payload never arrives, and the only recovery left is the
 * document load the browser would have made directly. Handing it that navigation up front also gives the
 * entry the file loads into the browser's own history, so Back is an ordinary cross-document traversal. An
 * intercepted entry is same-document by construction, and traversing one with nothing to repaint it changes
 * the URL and nothing else — which is what a Back press out of an opened file was doing.
 *
 * A dot in the last path segment rather than a list of extensions: a list is never complete, and every miss
 * is the failed round trip above. A page route whose last segment carries a dot (`/release-1.0`) therefore
 * costs a document load — the direction to err in, and what a `data-native` link already asks for by hand.
 */
function namesAFile(href: string): boolean {
  const lastSegment = new URL(href).pathname.split('/').pop() ?? '';
  return lastSegment.includes('.');
}

/**
 * Navigations the browser can hand over but shouldn't:
 *
 * - a fragment jump, which is same-document already and needs no payload — the browser's own jump is the one
 *   that honours `scroll-padding-top`, and re-rendering would pull the target out from under it;
 * - a download, which is not a navigation of this page at all;
 * - a `POST` form, which is a submission and the server's to answer (a `GET` form carries its fields in the
 *   URL, has no `formData`, and soft-navigates like any other link);
 * - a link marked `data-native`, the documented opt-out;
 * - a destination that names a file — see {@link namesAFile}.
 */
function leaveToBrowser(event: NavigateEvent): boolean {
  return (
    event.hashChange ||
    event.downloadRequest !== null ||
    event.formData !== null ||
    event.sourceElement?.hasAttribute('data-native') === true ||
    namesAFile(event.destination.url)
  );
}

/**
 * The scroll a committing navigation owes: a push reaches its own fragment or the top, an in-place change
 * stays where it is. Read at commit rather than at dispatch, so a redirect the preparation followed lands
 * on the fragment it actually committed.
 */
function afterCommitFor(event: NavigateEvent): (() => void) | undefined {
  if (event.navigationType !== 'push') return undefined;
  const { hash } = new URL(event.destination.url);
  return hash === '' ? scrollToTop : () => jumpToAnchor(hash);
}

/** `event.intercept({ precommitHandler })`, where the browser has it: the URL is held until the payload is known. */
const canPrecommit = typeof NavigationPrecommitController !== 'undefined';

const REDIRECT_LIMIT = 10;

/**
 * A push or replace, with the payload fetched *before* the URL commits. The address bar keeps naming the
 * page on screen while the next one is on the wire, and a redirect the payload carries is resolved here —
 * `controller.redirect()` — so the navigation commits once, at its final URL, as a single history entry.
 *
 * Each hop is its own resource; the ones a redirect leaves behind are discarded as it goes. The resource the
 * loop ends on is the one the handler shows: the same object, the same fetch, the same abort switch.
 */
function interceptBeforeCommit(event: NavigateEvent): void {
  event.intercept({
    scroll: 'manual',
    focusReset: event.navigationType === 'replace' ? 'manual' : 'after-transition',
    precommitHandler: async (controller: NavigationPrecommitController) => {
      discardPrepared();
      const visited = new Set<string>();
      let href = event.destination.url;
      let resource: PageResource | undefined;
      /** Where a document load should go instead, when the redirect cannot be followed in place. */
      let recovery: string | undefined;
      try {
        for (;;) {
          if (visited.has(href) || visited.size >= REDIRECT_LIMIT)
            throw new Error(`[rsvhono] the payload for ${event.destination.url} redirects in a loop`);
          visited.add(href);
          resource = prepare(href, event.signal);
          const root = await resource.rootReady;
          if (event.signal.aborted || resource.controller.signal.aborted) throw superseded();
          if (!root.redirect) break;
          const target = new URL(root.redirect, href);
          if (target.origin !== location.origin || namesAFile(target.href)) {
            recovery = target.href;
            throw new Error(`[rsvhono] cannot soft-navigate to ${target.href}`);
          }
          discard(resource);
          // Forgotten, so the `catch` below does not read a hop's own discard as the navigation's cancellation.
          resource = undefined;
          href = target.href;
        }
        if (href !== event.destination.url) controller.redirect(href);
        const ready = resource;
        controller.addHandler(() => perform(event, ready, afterCommitFor(event)));
      } catch (error) {
        const cancelled = event.signal.aborted || resource?.controller.signal.aborted === true;
        if (resource) discard(resource);
        // Nothing has committed, so the document load starts from the page still on screen — and lets the
        // server answer for the destination itself: its error page, its 404, its cross-origin redirect.
        if (!cancelled) leave(recovery ?? event.destination.url);
        throw error;
      }
    },
  });
}

/** A reload — or a push or replace where the browser has no precommit phase: the URL commits, then the payload is fetched. */
function interceptAfterCommit(event: NavigateEvent): void {
  const inPlace = event.navigationType === 'replace' || event.navigationType === 'reload';
  event.intercept({
    scroll: 'manual',
    focusReset: inPlace ? 'manual' : 'after-transition',
    handler: () => {
      discardPrepared();
      return perform(event, prepare(event.destination.url, event.signal), afterCommitFor(event));
    },
  });
}

/**
 * Back and Forward. The browser commits the entry first — a traversal has no precommit phase — and the
 * handler repaints it.
 *
 * When the entry is the document already on screen (a fragment-only traversal, or Back onto the page a
 * suspended navigation never replaced) there is nothing to fetch. If a render is pending, the committed
 * payload is shown again, urgently: that releases the suspended destination, and — being a new attempt on
 * the same resource — commits and reports like any other.
 */
function interceptTraversal(event: NavigateEvent): void {
  const request = requestOf(event);
  const destination = new URL(event.destination.url);
  const key = event.destination.key;
  const restoreScroll = () => {
    const stored = scrollPointFor(key);
    if (stored) scrollToPoint(stored);
    else if (destination.hash !== '') jumpToAnchor(destination.hash);
    else scrollToTop();
  };
  event.intercept({
    scroll: 'manual',
    focusReset: 'manual',
    handler: async () => {
      discardPrepared();
      const onScreen = committedAttempt();
      if (!onScreen || documentPart(destination) !== onScreen.href) {
        return perform(event, prepare(destination.href, event.signal), () => {
          restoreScroll();
          resetFocus();
        });
      }
      if (pendingAttempt()) {
        const again = createAttempt(onScreen.resource, onScreen.payload, onScreen.href, { afterCommit: restoreScroll });
        const outcome = await schedule(again, { urgent: true });
        // The payload has rendered before, but an uncaught error would still tear the root down.
        if (outcome.kind === 'failed') return leave();
        if (outcome.kind === 'superseded') return;
      } else restoreScroll();
      if (!event.signal.aborted) finishRequest(request, rendered());
    },
  });
}

export function listenNavigation(): () => void {
  if (!canSoftNavigate) return () => {};

  const onNavigate = (event: NavigateEvent) => {
    // React's own: with a transition pending and no navigation under way it starts one at the current URL,
    // so the browser shows its loading indicator, and intercepts it itself. Not a navigation of the page.
    if (event.info === 'react-transition') return;
    if (event.info === documentNavigation) return;

    const request = requestOf(event);
    if (activeRequest && activeRequest !== request) rejectRequest(activeRequest, superseded());
    activeRequest = request;
    cancelElementWatches();
    // Before the browser moves: the offset belongs to the entry being left.
    rememberCurrentScroll();

    if (event.canIntercept && event.navigationType === 'traverse') return interceptTraversal(event);

    if (!event.canIntercept || leaveToBrowser(event)) {
      if (!request) return;
      // The browser performs a fragment jump alone; `ask` settles the request from its `finished`.
      if (event.hashChange) request.browserOnly = true;
      else finishRequest(request, { kind: 'document-navigation' });
      return;
    }

    if (canPrecommit && event.navigationType !== 'reload') interceptBeforeCommit(event);
    else interceptAfterCommit(event);
  };

  navigation.addEventListener('navigate', onNavigate);
  return () => {
    navigation.removeEventListener('navigate', onNavigate);
    discardPrepared();
  };
}
