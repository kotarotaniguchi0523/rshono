/**
 * The browser entry: hydrate the document with the payload it carries, then hand over to the pieces in
 * `browser/` —
 *
 *   page-resource.ts    a flight payload being read: the fetch, its root, its one abort switch, who holds it
 *   render-attempt.ts   one request to show a payload, and whether React committed it
 *   root.tsx            the React state and the router context
 *   navigation.ts       the Navigation API: precommit, redirects, traversal, what `finished` means
 *   server-function.ts  action calls, their return values, and whether their page may be shown
 *   document.ts         leaving for a new document, and the panels for when this one cannot go on
 *   scroll.ts           scroll and focus across navigations
 */
import { hydrateRoot } from 'react-dom/client';
import { RECOVERY_GRACE_MS, documentUrl, lateNotFoundKey, showFatal } from './browser/document.js';
import { handleControlDigest, refetch } from './browser/navigation.js';
import { inlineResource } from './browser/page-resource.js';
import { createAttempt, failPending, pendingAttempt } from './browser/render-attempt.js';
import { BrowserRoot } from './browser/root.js';
import { currentEntryKey, readStoredScrollPositions, scrollPointFor, scrollToPoint } from './browser/scroll.js';
import { installServerFunctions } from './browser/server-function.js';

/**
 * The history mode for a `redirect()` that surfaced through React, where the pending attempt is the render
 * that raised it. A navigation payload names the URL that raised the redirect, so the redirect replaces that
 * entry. An action reply re-renders the page the visitor is already on — a GET of it does not re-run the
 * action — so its redirect keeps the push the action's other redirect paths have, and Back returns to the
 * page that submitted the form.
 */
const controlDigestHistory = (): 'push' | 'replace' => (pendingAttempt()?.recoversByLoad === false ? 'push' : 'replace');

async function main() {
  // The document's own payload is a resource like any other; only its abort switch is inert.
  const resource = inlineResource();
  const payload = await resource.rootReady;

  // The notFound page rendered as a real 404: the recovery reload for this URL did its job, so release it.
  if (payload.notFound) {
    try {
      sessionStorage.removeItem(lateNotFoundKey());
    } catch {
      // Storage is unavailable; then the bound was never recorded either.
    }
  }

  // A reload of this document: the browser's own restoration is off (`document.ts`), so put the offset back.
  readStoredScrollPositions();
  const restored = scrollPointFor(currentEntryKey());
  const initial = createAttempt(resource, payload, documentUrl(), { afterCommit: restored ? () => scrollToPoint(restored) : undefined });

  installServerFunctions();

  hydrateRoot(document, <BrowserRoot initial={initial} />, {
    formState: payload.formState,
    onCaughtError: (error, errorInfo) => {
      if (handleControlDigest(error, { hard: true, history: controlDigestHistory() })) return;
      console.error(error, errorInfo.componentStack ?? '');
    },
    onUncaughtError: (error, errorInfo) => {
      // React unmounts the root on an uncaught error, so a redirect or notFound that got this far needs a
      // document to land in.
      if (handleControlDigest(error, { hard: true, history: controlDigestHistory() })) return;
      globalThis.reportError(error);
      // Whoever awaits the render that just died — a navigation handler — takes its own recovery: a document
      // load, which the server answers with the app's error page. The panel is for when there is no such
      // recovery (the first render, an action reply) and, after a grace period, for when the load never came.
      const failed = failPending(error);
      if (failed?.recoversByLoad) setTimeout(() => showFatal(error, errorInfo.componentStack), RECOVERY_GRACE_MS);
      else showFatal(error, errorInfo.componentStack);
    },
  });

  // Client modules are Vite's own Fast Refresh. This is the other half: a server component changed, so
  // re-read the payload and show it — client state is kept. `import.meta.hot` is `undefined` in a production
  // build, which drops the block.
  import.meta.hot?.on('rsc:update', () => {
    console.log('[rsvhono] server components updated');
    refetch();
  });
}

// A bootstrap failure — a truncated inlined payload, a chunk that would not load — leaves a server-rendered
// page that looks alive and responds to nothing. Say so.
main().catch((error) => {
  console.error('[rsvhono] the client runtime failed to start:', error);
  showFatal(error);
});
