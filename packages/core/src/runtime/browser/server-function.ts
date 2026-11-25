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
import { isControlDigest } from '../control.js';
import { createRscRequest } from '../request.js';
import { documentUrl } from './document.js';
import { followRootIntent, mutationCompleted, navigating, navigationIntent, push, revalidate } from './navigation.js';
import { requestResource } from './page-resource.js';
import { createAttempt, schedule } from './render-attempt.js';

let lastCall = 0;
/** The newest call whose page payload reached the screen. An older reply landing later is an older snapshot. */
let lastShown = 0;

let inFlight = 0;
/**
 * Whether two calls were ever in flight together since the last re-read. The order calls were *made* in is
 * not the order the server applied them in, so neither reply can be trusted to be the newer snapshot: when
 * the last of them settles, the page is re-read once.
 */
let overlapped = false;

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
      const request = createRscRequest(window.location.href, { id, body: await encodeReply(args, { temporaryReferences }) });
      const resource = requestResource('action', request, controller, temporaryReferences);

      let payload;
      try {
        payload = await resource.rootReady;
      } catch (error) {
        mutationCompleted();
        // A `redirect()` or `notFound()` that arrived as an error is a change of screen like any other.
        if (isControlDigest((error as { digest?: unknown } | null)?.digest) && !ownsScreen()) {
          revalidate();
          return undefined;
        }
        if (followRootIntent(resource, error)) return undefined;
        throw error;
      }

      mutationCompleted();
      if (!ownsScreen()) revalidate();
      else if (payload.redirect) void push(payload.redirect);
      else if (call > lastShown) {
        lastShown = call;
        void schedule(createAttempt(resource, payload, calledFrom, { recoversByLoad: false }));
      }

      // A redirect or `notFound()` has no value to hand back, wherever the screen went.
      if (payload.redirect || payload.notFound) return undefined;
      const result = payload.returnValue;
      if (!result) {
        throw new Error(
          '[rsvhono] the server action produced no result — the request failed around it and the server answered with a page instead. Its log has the error.',
        );
      }
      if (!result.ok) throw result.error;
      return result.value;
    } finally {
      if (--inFlight === 0 && overlapped) {
        overlapped = false;
        revalidate();
      }
    }
  });
}
