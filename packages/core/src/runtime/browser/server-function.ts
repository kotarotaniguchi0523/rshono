/**
 * Server functions called from the browser: the call, its reply, and whether that reply may change the screen.
 *
 * A reply carries two things that are answered separately. The **return value** (or the error) always goes
 * back to the caller: the mutation ran, whatever happened to the screen since. Everything that *changes the
 * screen* — the re-rendered page, a `redirect()`, a `notFound()` — passes one test first: nothing has asked to
 * navigate since the call was made. A reply that fails it changes nothing, and the page the visitor ends up on
 * is re-read instead, because it may have been rendered before the mutation.
 */
import { createTemporaryReferenceSet, encodeReply, setServerCallback } from '@vitejs/plugin-rsc/browser';
import { BuildMismatchError } from '../build-id.js';
import { parseControlIntent } from '../control.js';
import { createRscRequest } from '../request.js';
import { documentUrl, reloadForBuild } from './document.js';
import { followRootIntent, mutationCompleted, navigating, navigationIntent, push, revalidate } from './navigation.js';
import { requestResource } from './page-resource.js';
import { createAttempt, schedule } from './render-attempt.js';

let lastCall = 0;
/** The newest call whose page payload reached the screen. An older reply landing later is an older snapshot. */
let lastShown = 0;

let inFlight = 0;
/**
 * Whether two calls whose replies carry a page were in flight together since the last re-read. The order
 * calls were *made* in is not the order the server applied them in, so neither page can be trusted to be the
 * newer snapshot: when the last call settles, the page is re-read once.
 */
let overlapped = false;
/** Whether any reply since the last quiet moment carried a page. A reply that carried none aged nothing. */
let pagesArrived = false;

export function installServerFunctions(): void {
  setServerCallback(async (id, args) => {
    const temporaryReferences = createTemporaryReferenceSet();
    const calledFrom = documentUrl();
    const intent = navigationIntent();
    const call = ++lastCall;
    if (inFlight++ > 0) overlapped = true;
    /** Whether this reply may change the screen: no navigation has been asked for since, and none is under way. */
    const ownsScreen = () => navigationIntent() === intent && !navigating();

    try {
      // Not wired to the request: nothing on the client may cancel a mutation's reply. Leaving the page loses
      // the right to *show* it, not the caller's right to its result.
      const controller = new AbortController();
      const request = createRscRequest(calledFrom, { id, body: await encodeReply(args, { temporaryReferences }) });
      const resource = requestResource('action', request, controller, temporaryReferences);

      let payload;
      try {
        payload = await resource.rootReady;
      } catch (error) {
        pagesArrived = true;
        mutationCompleted();
        // The server is another build: it refused the call before running anything, and this page can call
        // nothing on it. The caller is told — the call is not sent again, here or after the reload, since
        // nothing says it is safe to — and the page is replaced with the server's own, once the caller's
        // handlers have had the rejection.
        if (error instanceof BuildMismatchError) {
          const { serverBuild } = error;
          setTimeout(() => reloadForBuild(serverBuild), 0);
          throw error;
        }
        // A `redirect()` or `notFound()` that arrived as an error is a change of screen like any other.
        if (!parseControlIntent(error)) throw error;
        if (ownsScreen()) followRootIntent(resource, error);
        else revalidate();
        return undefined;
      }

      // The reply is the result and nothing else — the function did not ask for the page. Nothing on screen
      // is older for it, so there is nothing to show, nothing to re-read, and no navigation to weigh it against.
      if (!payload.resultOnly) {
        pagesArrived = true;
        mutationCompleted();
        if (!ownsScreen()) revalidate();
        else if (payload.redirect) void push(payload.redirect);
        else if (call > lastShown) {
          lastShown = call;
          void schedule(createAttempt(resource, payload, calledFrom, { recoversByLoad: false }));
        }
      }

      // What the function returned is the caller's whatever became of the screen: a page that redirected or
      // turned out not to exist *after* the function finished does not take its result back. Only a function
      // that itself ended in `redirect()` or `notFound()` has none, and that is not a missing result.
      const result = payload.returnValue;
      if (!result && (payload.redirect || payload.notFound)) return undefined;
      if (!result) {
        throw new Error(
          '[rsvhono] the server action produced no result — the request failed around it and the server answered with a page instead. Its log has the error.',
        );
      }
      if (!result.ok) throw result.error;
      return result.value;
    } finally {
      if (--inFlight === 0) {
        if (overlapped && pagesArrived) revalidate();
        overlapped = pagesArrived = false;
      }
    }
  });
}
