/**
 * The document itself: what URL it is, how to leave it for a new one, and what to paint when it cannot go on.
 * Nothing here knows about payloads or React.
 */
export const isDev = process.env.NODE_ENV === 'development';

/**
 * The part of the location a payload is rendered for — the document, without the fragment, which the server
 * never sees. Two URLs that differ only by `#hash` describe the same payload.
 */
export const documentUrl = (): string => location.pathname + location.search;

/** Guarantees somewhere to attach the fatal overlay: the root container is `document`, so a teardown can take `<body>` with it. */
function overlayHost(): HTMLElement {
  if (!document.documentElement) document.appendChild(document.createElement('html'));
  if (!document.body) document.documentElement.appendChild(document.createElement('body'));
  return document.body;
}

/**
 * Paints a full-viewport panel over whatever is on screen, and returns the box for the caller to fill.
 *
 * DOM calls rather than React (one caller runs because the renderer just failed), and `textContent` rather
 * than `innerHTML` (an error message is untrusted input). Queued on a macrotask: React's teardown runs after
 * the callback that reaches here returns, and would remove a node appended inline.
 */
function paintOverlay(fill: (box: HTMLElement) => void): void {
  setTimeout(() => {
    const host = overlayHost();
    host.querySelector('[data-rsvhono-fatal]')?.remove();

    const box = document.createElement('div');
    box.setAttribute('data-rsvhono-fatal', '');
    box.setAttribute('role', 'alert');
    box.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:1.5rem;background:#18181b;color:#f4f4f5;' +
      'font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:left';

    fill(box);
    host.appendChild(box);
  }, 0);
}

/** The overlay's heading. */
function overlayTitle(text: string): HTMLElement {
  const title = document.createElement('div');
  title.textContent = text;
  title.style.cssText = 'font-size:1.0625rem;font-weight:700;color:#f87171;margin:0 0 0.75rem';
  return title;
}

/**
 * Paints the reason for an uncaught render error over the blank page it leaves behind — the full stack in
 * dev, a generic notice and a reload button in production.
 */
export function showFatal(error: unknown, componentStack?: string | null): void {
  paintOverlay((box) => {
    box.appendChild(overlayTitle(isDev ? 'Unhandled error' : 'Something went wrong'));

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
    reload.addEventListener('click', () => loadDocument());
    box.appendChild(reload);
  });
}

/**
 * The end of the line for a `notFound()` that arrived too late to be a 404 and did not survive a reload.
 *
 * No reload button, unlike {@link showFatal}: the reload has already been spent, and the second identical
 * response is what brought us here. "Page not found" is what the server was trying to say, so it is what the
 * visitor is told; the reason it could not say it properly is a message for whoever wrote the page, and dev is
 * where they are.
 */
function showLateNotFound(): void {
  paintOverlay((box) => {
    box.appendChild(overlayTitle('Page not found'));

    const message = document.createElement('p');
    message.textContent = isDev
      ? 'notFound() was raised from a boundary that resolved after the page shell had been sent, so the response ' +
        'could not be a 404 — and reloading rendered the same page again. Decide before the render starts ' +
        'streaming: in Hono middleware, or in the page component body above the boundary.'
      : 'This page is not available.';
    message.style.cssText = 'margin:0;color:#d4d4d8';
    box.appendChild(message);
  });
}

/**
 * Whether the browser hands us its navigations. Gated on `sourceElement` rather than on `navigation` itself:
 * Chrome shipped the event in 102 and that property only in 135, and without it a `data-native` link cannot
 * be told from any other — so the older window would soft-navigate the very links that asked not to be.
 *
 * Where this is false there is no interception at all and every navigation is a real browser load, which a
 * server-rendered app answers correctly on its own. Only the soft part is missing.
 *
 * Both globals are tested, and neither is touched before: this runs at module scope, where a ReferenceError
 * would take the whole client runtime down with it rather than degrading anything.
 */
export const canSoftNavigate =
  typeof navigation !== 'undefined' && typeof NavigateEvent !== 'undefined' && 'sourceElement' in NavigateEvent.prototype;

/**
 * The runtime owns a soft navigation's scroll, so the browser's own restoration has to be off: left on, a
 * traversal restores the destination's offset against the outgoing tree before the payload for that entry
 * has even been asked for, and the incoming tree overwrites it. `manual` only concerns the entries this
 * document creates — a navigation to another document creates its own entry `auto` — and it also turns the
 * browser's reload restoration off, which {@link readStoredScrollPositions} and the first layout effect put
 * back.
 *
 * Gated on the soft router: below the Navigation API floor every navigation is a real document load, which
 * a server-rendered app answers correctly and the browser restores correctly, and taking that over without
 * a router to repaint the entry would strand the visitor at the top.
 */
if (canSoftNavigate) {
  try {
    history.scrollRestoration = 'manual';
  } catch {
    // A preference, not a requirement: where it cannot be set, the browser's restoration and the runtime's
    // own can race on a traversal, and the runtime's runs at commit, after.
  }
}

/**
 * Drops a navigation's result promises. Both reject when a navigation is superseded or cancelled — routine
 * here, since a second click is meant to abandon the first — and unhandled they would be reported as faults.
 */
export function settle(result: NavigationResult): void {
  const ignore = () => {};
  void result.committed?.catch(ignore);
  void result.finished?.catch(ignore);
}

/**
 * The mark {@link loadDocument} puts on its navigations, so the `navigate` listener below recognizes them as
 * the runtime's own. A symbol because the identity has to survive the trip through the browser intact:
 * `NavigateEvent.info` hands the value back by reference, so only the navigation that was given it matches.
 */
export const documentNavigation = Symbol('rsvhono:document-navigation');

/**
 * Performs a navigation the router below must **not** intercept, and returns having asked for it.
 *
 * `listenNavigation` intercepts a `reload` on purpose — that is what `router.refresh()` is — and every caller
 * here is reaching for a *new document* precisely because the current one cannot be repaired: the React root
 * a soft load would render into is the thing that just failed, or is about to be torn down. Intercepted, the
 * escape hatch becomes a payload fetch that lands nowhere — which is how a late `notFound()` left the tab on
 * its Suspense fallback with no second document ever arriving, and how a late `redirect()` moved the address
 * bar to a page it then failed to render.
 *
 * `replace` puts the loaded document in place of the current entry rather than after it, which is what a
 * redirect recovery owes: the entry being left is the URL that raised the redirect, and a 30x would have
 * replaced it, so Back must reach whatever preceded it rather than the URL that redirects again.
 *
 * The mark rides the navigation itself, through `info`, so the listener recognizes the event that owns it
 * instead of consuming a flag set in advance. There is no state to clear and none to leak: a navigation the
 * browser refuses cannot make the next one a full load. Below the Navigation API there is no interception to
 * opt out of, and `location.*` is already a document load.
 */
export function loadDocument(href?: string, { replace = false }: { replace?: boolean } = {}): void {
  if (!canSoftNavigate) {
    if (href === undefined) window.location.reload();
    else if (replace) window.location.replace(href);
    else window.location.assign(href);
    return;
  }

  try {
    settle(
      href === undefined
        ? navigation.reload({ info: documentNavigation })
        : navigation.navigate(href, { history: replace ? 'replace' : 'auto', info: documentNavigation }),
    );
  } catch {
    // The Navigation API refuses a document that is not fully active — it is unloading — and a URL it cannot
    // parse. Both callers are recovery paths, where a throw here becomes an unhandled rejection rather than
    // the document load they asked for. `location.*` is the same load without the interception, and its own
    // refusal (the same unparseable URL) is swallowed because there is then no load left to make.
    try {
      if (href === undefined) window.location.reload();
      else if (replace) window.location.replace(href);
      else window.location.assign(href);
    } catch {
      // Nothing to navigate to. The caller is already recovering from a failure, and the address bar still
      // describes the document on screen.
    }
  }
}

/**
 * How long a recovery document load is given to replace this one before the framework paints the panel the
 * load stands in for. Both recoveries — a late `notFound()` and a payload whose render tore the root down —
 * ask the browser for a real document, and this timer is all that is left when one is refused or swallowed.
 */
export const RECOVERY_GRACE_MS = 2000;

/** The `sessionStorage` key bounding the recovery reload for one URL. Spent here, released in {@link main}. */
export const lateNotFoundKey = (): string => `rsvhono:late-not-found:${documentUrl()}`;

/**
 * Spends the one reload a late `notFound()` gets, or paints if it has already been spent for this URL.
 *
 * `redirect()` is terminal on the client — there is somewhere to navigate to — and `notFound()` is not: the
 * response is already committed as a 200, so the only recovery left is asking for the page again and hoping
 * the signal comes early enough this time to be a real 404. That works where the lateness was incidental, a
 * boundary that happened to resolve after the shell on a slow request. Where it is structural — a page that
 * always signals from a late boundary — the reload gets a byte-identical response and reloads again, and the
 * tab spins until the visitor leaves. In production nothing is logged, because the warning that explains this
 * is `isDev`-only.
 *
 * So it is bounded: one reload per URL per tab, then {@link showLateNotFound}. `sessionStorage` because the
 * value has to outlive the document it is written in and must not outlive the tab, and keyed by URL so a
 * second page's late signal still gets its own attempt.
 */
export function reloadOnceForLateNotFound(): void {
  const key = lateNotFoundKey();
  let spent: boolean;
  try {
    spent = sessionStorage.getItem(key) !== null;
    if (!spent) sessionStorage.setItem(key, '1');
  } catch {
    // Storage can throw outright where site data is blocked, and a page that cannot count its reloads has
    // to pick a side. It picks the terminating one: a message on a page that might have recovered is a
    // worse outcome than a reload loop only by a lot less.
    spent = true;
  }
  if (spent) {
    showLateNotFound();
    return;
  }

  loadDocument();

  // The reload wins this race whenever it happens at all: the document goes away and takes the timer with
  // it. What this covers is a reload that does not happen — swallowed by an interceptor, refused by the
  // browser, held by a `beforeunload` — which used to leave the visitor on a Suspense fallback with nothing
  // coming and nothing said. The panel is the honest answer in that case too.
  setTimeout(() => {
    if (!document.querySelector('[data-rsvhono-fatal]')) showLateNotFound();
  }, RECOVERY_GRACE_MS);
}
