import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import {
  createFromFetch,
  createFromReadableStream,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from 'react-server-dom-rspack/client.browser';
import { isControlDigest, parseRedirectDigest } from './control.js';
import type { DevMessage } from './dev-protocol.js';
import type { RscPayload } from './entry.rsc.js';
// Dev-only: its one caller sits behind `import.meta.webpackHot`, which a production build compiles to
// `false` — so this module is dropped there.
import { walkHotUpdates } from './hot-update.js';
import { RouterContext, type NavigationRouter } from './navigation.js';
import { createRscRequest } from './request.js';

const isDev = process.env.NODE_ENV === 'development';
const softRefreshInfo = Symbol('rshono-soft-refresh');

declare global {
  /** The array the payload `<script>` tags `flight-inject.ts` emits push their chunks into. */
  var __FLIGHT_DATA: Array<string | Uint8Array> | undefined;
}

/** The flight payload the document carried, read back out of `__FLIGHT_DATA` — see `flight-inject.ts`. */
function readFlightPayload(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Assigned synchronously by `start`, which `new ReadableStream` runs before it returns.
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
  });
  const enqueue = (chunk: string | Uint8Array) => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);

  // Payload scripts interleave with the document: the ones that already ran are in the array, the rest
  // arrive through `push`.
  const data = (self.__FLIGHT_DATA ??= []);
  for (const chunk of data) enqueue(chunk);
  data.push = enqueue as typeof data.push;

  // The last payload script lands before parsing finishes, so that is what closes the stream.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => controller.close(), { once: true });
  } else {
    controller.close();
  }
  return stream;
}

/** Created at module evaluation, not inside `main()`, so no chunk can be pushed before it is watching. */
const flightStream = readFlightPayload();

/**
 * The part of the location a payload is rendered for — the document, without the fragment, which the server
 * never sees. Two URLs that differ only by `#hash` describe the same payload.
 */
const documentUrl = (): string => location.pathname + location.search;

/** Guarantees somewhere to attach the fatal overlay: the root container is `document`, so a teardown can take `<body>` with it. */
function overlayHost(): HTMLElement {
  if (!document.documentElement) document.appendChild(document.createElement('html'));
  if (!document.body) document.documentElement.appendChild(document.createElement('body'));
  return document.body;
}

/**
 * Paints the reason for an uncaught render error over the blank page it leaves behind — the full stack in
 * dev, a generic notice and a reload button in production.
 *
 * DOM calls rather than React (the renderer is what just failed), and `textContent` rather than
 * `innerHTML` (an error message is untrusted input).
 */
function showFatal(error: unknown, componentStack?: string | null): void {
  // Queued: React's teardown runs after this callback returns and would remove a node appended inline.
  setTimeout(() => {
    const host = overlayHost();
    host.querySelector('[data-rshono-fatal]')?.remove();

    const box = document.createElement('div');
    box.setAttribute('data-rshono-fatal', '');
    box.setAttribute('role', 'alert');
    box.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:1.5rem;background:#18181b;color:#f4f4f5;' +
      'font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:left';

    const title = document.createElement('div');
    title.textContent = isDev ? 'Unhandled error' : 'Something went wrong';
    title.style.cssText = 'font-size:1.0625rem;font-weight:700;color:#f87171;margin:0 0 0.75rem';
    box.appendChild(title);

    if (isDev) {
      const detail = document.createElement('pre');
      detail.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-word';
      detail.textContent =
        (error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)) +
        (componentStack ? `\n\nComponent stack:${componentStack}` : '');
      box.appendChild(detail);
    } else {
      const message = document.createElement('p');
      message.textContent = 'This page hit an unexpected error and can’t continue.';
      message.style.cssText = 'margin:0 0 1rem;color:#d4d4d8';
      box.appendChild(message);
    }

    const reload = document.createElement('button');
    reload.textContent = 'Reload page';
    reload.style.cssText =
      'margin-top:1.25rem;padding:0.5rem 1rem;font:inherit;color:#18181b;background:#f4f4f5;border:0;border-radius:4px;cursor:pointer';
    reload.addEventListener('click', () => window.location.reload());
    box.appendChild(reload);

    host.appendChild(box);
  }, 0);
}

/**
 * Asks a URL for its flight payload. Deliberately uncached — a payload can never be staler than the click
 * that wanted it, and the browser's own HTTP cache is what makes a repeat visit cheap.
 */
function requestPayload(href: string, signal: AbortSignal): Promise<RscPayload> {
  return createFromFetch<RscPayload>(fetch(createRscRequest(new URL(href, location.href).href, undefined, signal)));
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function main() {
  // The assertion is load-bearing under the compiler that builds this: TypeScript 7 declares `nonce` on
  // HTMLElement, 6 declares it on Element. ESLint runs the older lib — where the narrowing is redundant —
  // so it reports an assertion that `tsc` requires. Believe `typecheck`, not the rule.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const cspMeta = document.querySelector('meta[property="csp-nonce"]') as HTMLMetaElement | null;
  if (cspMeta?.nonce) __webpack_nonce__ = cspMeta.nonce;

  // Both are replaced by BrowserRoot's own on mount. The defaults cover the window before hydration, where
  // `setServerCallback` is already registered but there is no root to update — a reload is the honest answer.
  let setPayload: (v: RscPayload) => void = () => {
    window.location.reload();
  };
  // Runs work inside the nav transition so useNavigation().pending stays true across the round-trip.
  let startNav: (run: () => void | Promise<void>) => void = (run) => {
    void run();
  };

  const initialPayload = await createFromReadableStream<RscPayload>(flightStream);

  function observeNavigation(result: NavigationResult): void {
    void result.finished?.catch(() => {});
  }

  function navigate(href: string, mode: 'push' | 'replace' = 'push'): void {
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) {
      if (mode === 'replace') window.location.replace(target.href);
      else window.location.assign(target.href);
      return;
    }
    observeNavigation(window.navigation.navigate(target.href, { history: mode }));
  }

  const push = (href: string) => navigate(href, 'push');
  const replace = (href: string) => navigate(href, 'replace');

  // A traversal is the browser's to perform. It enters the same Navigation API handler as links and
  // imperative navigations, so it inherits the same fetch and `pending` behavior.
  const back = () => observeNavigation(window.navigation.back());
  const forward = () => observeNavigation(window.navigation.forward());

  const refresh = () => observeNavigation(window.navigation.reload({ info: softRefreshInfo }));

  /**
   * Turns a control-signal digest — how `redirect()` / `notFound()` reach the browser — into a real
   * navigation. Returns false for anything else, so callers fall through to their own handling.
   *
   * `hard` forces a full document load, for signals that surfaced *through React*: it unmounts the root on
   * an uncaught error, leaving no live tree to soft-navigate with.
   */
  function handleControlDigest(error: unknown, { hard = false }: { hard?: boolean } = {}): boolean {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (!isControlDigest(digest)) return false;
    const redirect = parseRedirectDigest(digest);
    if (!redirect) {
      window.location.reload();
    } else if (hard) {
      window.location.assign(new URL(redirect.location, window.location.href).href);
    } else {
      push(redirect.location);
    }
    return true;
  }

  /**
   * The navigation whose payload the screen is allowed to show. React runs async transitions concurrently, so
   * two overlapping navigations are two live fetches with no ordering between them — without this, a slow
   * first response landing after a fast second one renders the page the user already left while the address
   * bar shows the one they asked for.
   */
  let currentNavigation = 0;
  /** The in-flight navigation's fetch, so a newer one can stop paying for it. */
  let navigationFetch: AbortController | null = null;

  /**
   * Fetches the payload for the current URL and applies it, unless a newer navigation started meanwhile.
   *
   * @returns `true` when this navigation is the one that settled the screen, `false` when it was superseded.
   *   The distinction is what keeps a stale response from scrolling a page it is no longer rendering — and
   *   why being superseded resolves rather than throws: both callers answer a rejection with a full reload,
   *   so surfacing the abort would turn every fast second click into one.
   */
  async function fetchRscPayload(): Promise<boolean> {
    const navigation = ++currentNavigation;
    navigationFetch?.abort();
    const controller = (navigationFetch = new AbortController());
    const superseded = () => navigation !== currentNavigation;

    let payload: RscPayload;
    try {
      payload = await requestPayload(window.location.href, controller.signal);
    } catch (error) {
      // Checked before the error is read: an abort is this navigation being replaced, and the one that
      // replaced it owns the outcome.
      if (superseded()) return false;
      if (handleControlDigest(error)) return true;
      throw error;
    }
    if (superseded()) return false;
    if (payload.redirect) {
      push(payload.redirect);
      return true;
    }
    setPayload(payload);
    return true;
  }

  function BrowserRoot() {
    const [payload, setPayloadState] = React.useState(initialPayload);
    const [pending, startTransition] = React.useTransition();
    // The scroll a fetched navigation still owes, held until its payload is on screen.
    const pendingScroll = React.useRef<(() => void) | null>(null);

    React.useEffect(() => {
      setPayload = (v) => setPayloadState(v);
      startNav = (run) => startTransition(run);
    }, [startTransition]);

    /**
     * Scrolls where the navigation asked, once React has put its payload in the DOM — a `#hash` target does
     * not exist until the new tree does. A layout effect, so the pre-scroll position is never painted.
     */
    React.useLayoutEffect(() => {
      const scroll = pendingScroll.current;
      pendingScroll.current = null;
      scroll?.();
    }, [payload]);

    React.useEffect(() => {
      const stopNavigating = listenNavigation(
        (afterRender) =>
          new Promise<void>((resolve) => {
            startNav(async () => {
              try {
                // Only the navigation that settled the screen owes a scroll — a superseded one would move the
                // page the navigation that replaced it is about to render.
                if (await fetchRscPayload()) pendingScroll.current = afterRender;
              } catch {
                window.location.reload();
              }
              resolve();
            });
          }),
      );
      return stopNavigating;
    }, []);

    const router = React.useMemo<NavigationRouter>(() => ({ push, replace, back, forward, refresh, pending }), [pending]);

    return <RouterContext.Provider value={router}>{payload.root}</RouterContext.Provider>;
  }

  setServerCallback(async (id, args) => {
    const temporaryReferences = createTemporaryReferenceSet();
    // The document the action is being called from. Every action response carries a fresh payload for that
    // page, so if a navigation has moved on by the time it arrives the payload describes a page the user has
    // left — the return value is still theirs, but painting it is not. Compared without the fragment, which
    // the server never saw.
    const calledFrom = documentUrl();
    const request = createRscRequest(window.location.href, {
      id,
      body: await encodeReply(args, { temporaryReferences }),
    });
    let payload: RscPayload;
    try {
      payload = await createFromFetch<RscPayload>(fetch(request), { temporaryReferences });
    } catch (error) {
      if (handleControlDigest(error)) return undefined;
      throw error;
    }
    if (payload.redirect) {
      push(payload.redirect);
      return undefined;
    }
    if (documentUrl() === calledFrom) React.startTransition(() => setPayload(payload));
    if (payload.notFound) return undefined;
    const result = payload.returnValue!;
    if (!result.ok) throw result.error;
    return result.value;
  });

  // A `redirect()` / `notFound()` from a component below the page root reaches us through React: it rides the
  // flight payload as an error, and boundaries re-throw it so it lands here rather than in a fallback.
  //
  // Installing these hooks opts out of React's own defaults, so everything that isn't a control signal has to
  // be put back by hand — `reportError` rather than a bare log, so error-reporting tools still see it.
  hydrateRoot(document, <BrowserRoot />, {
    formState: initialPayload.formState,
    onCaughtError: (error, errorInfo) => {
      if (handleControlDigest(error, { hard: true })) return;
      // A boundary handled it and the tree is intact, so no overlay over the app's own fallback.
      console.error(error, errorInfo.componentStack ?? '');
    },
    onUncaughtError: (error, errorInfo) => {
      if (handleControlDigest(error, { hard: true })) return;
      // Nothing caught it, so React tears the root down — and the root is `document`.
      globalThis.reportError(error);
      showFatal(error, errorInfo.componentStack);
    },
  });

  if (import.meta.webpackHot) {
    initDevRefresh(fetchRscPayload);
  }
}

type NavigationType = 'push' | 'replace' | 'pop';

/** Runs teardown in reverse and empties the list, so a second call is a no-op. */
function disposeAll(undo: Array<() => void>): void {
  for (const dispose of undo.splice(0).reverse()) dispose();
}

/**
 * The element the current `#fragment` names, if it is on the page. A fragment is percent-encoded and an `id`
 * is not, so it is decoded first — and taken literally when a hand-written `%` makes that throw.
 */
function fragmentTarget(): HTMLElement | null {
  const fragment = location.hash.slice(1);
  if (!fragment) return null;
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // Malformed escape — the literal fragment is the better guess at the id than nothing.
  }
  return document.getElementById(id);
}

/** The Navigation API owns navigation classification; this predicate selects rshono's RSC document path. */
function shouldInterceptNavigation(event: NavigateEvent): boolean {
  if (!event.canIntercept || event.hashChange || event.downloadRequest !== null || event.formData !== null) return false;
  if (event.navigationType === 'reload' && event.info !== softRefreshInfo) return false;

  const target = new URL(event.destination.url, location.href);
  if (target.origin !== location.origin) return false;

  const source = event.sourceElement;
  if (source instanceof HTMLFormElement) return false;
  if (source instanceof HTMLAnchorElement) {
    if (source.target && source.target !== '_self') return false;
    if (source.hasAttribute('data-native')) return false;
  }
  return true;
}

function listenNavigation(onNavigation: (afterRender: () => void) => Promise<void>): () => void {
  const undo: Array<() => void> = [];

  const afterRenderFor = (type: NavigationType) => () => {
    if (type !== 'push') return;
    const target = fragmentTarget();
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  };

  const onNavigate = (event: NavigateEvent) => {
    if (!shouldInterceptNavigation(event)) return;

    const type: NavigationType =
      event.navigationType === 'traverse'
        ? 'pop'
        : event.navigationType === 'replace' || event.navigationType === 'reload'
          ? 'replace'
          : 'push';

    event.intercept({
      scroll: event.navigationType === 'traverse' ? 'after-transition' : 'manual',
      handler: () => onNavigation(afterRenderFor(type)),
    });
  };
  window.navigation.addEventListener('navigate', onNavigate);
  undo.push(() => window.navigation.removeEventListener('navigate', onNavigate));

  const onNavigateError = (event: Event) => {
    const error = (event as ErrorEvent).error;
    if (!isAbortError(error)) window.location.reload();
  };
  window.navigation.addEventListener('navigateerror', onNavigateError);
  undo.push(() => window.navigation.removeEventListener('navigateerror', onNavigateError));

  return () => disposeAll(undo);
}

/**
 * Dev-only refresh client, listening to the CLI's SSE endpoint:
 *
 *   client-built  → hot-apply the waiting updates; anything the page can't be patched up to reloads.
 *   rsc-update    → server component code changed: re-fetch the flight payload, state preserved.
 *   hello         → sent on (re)connect with the latest build hash; a mismatch means a missed event.
 */
// `Promise<unknown>`: the payload fetch reports whether its navigation was superseded, which matters to a
// click and not to a rebuild — here only settling or rejecting does.
function initDevRefresh(fetchRscPayload: () => Promise<unknown>) {
  const hot = import.meta.webpackHot!;
  let connectedOnce = false;
  /** The newest build the dev server has announced — what {@link applyClientUpdate} walks towards. */
  let targetHash: string | undefined;

  function reload(reason: string, error?: unknown): void {
    console.warn(`[rshono] ${reason} — reloading`, ...(error === undefined ? [] : [error]));
    window.location.reload();
  }

  async function applyClientUpdate(): Promise<void> {
    const giveUp = await walkHotUpdates(
      hot,
      () => __webpack_hash__,
      () => targetHash,
    );
    if (giveUp) reload(giveUp.reason, giveUp.error);
  }

  async function handle(message: DevMessage): Promise<void> {
    switch (message.type) {
      case 'hello':
        targetHash = message.hash ?? targetHash;
        if (connectedOnce) {
          await applyClientUpdate();
          await fetchRscPayload().catch(() => window.location.reload());
        }
        connectedOnce = true;
        break;
      case 'client-built':
        targetHash = message.hash;
        await applyClientUpdate();
        break;
      case 'rsc-update':
        console.log('[rshono] server components updated');
        await fetchRscPayload().catch(() => window.location.reload());
        break;
    }
  }

  const source = new EventSource('/_rshono/hmr');
  // Chained rather than handled as they arrive: `hot.check` may only run from `idle`, and a burst of saves
  // puts several frames on the wire inside the time one takes. Queueing drops nothing, because `targetHash`
  // is shared — whichever handler runs next walks to the newest build.
  let queue: Promise<void> = Promise.resolve();
  source.onmessage = (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as DevMessage;
    queue = queue.then(() => handle(message)).catch((error) => reload('the dev client failed', error));
  };
}

// A bootstrap failure — a truncated initial payload, most likely — would otherwise be an unhandled
// rejection: nothing hydrates, nothing is reported, and the page just sits there.
main().catch((error) => {
  console.error('[rshono] the client runtime failed to start:', error);
  showFatal(error);
});
