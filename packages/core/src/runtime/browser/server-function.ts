/**
 * Server functions called from the browser: the call, its reply, and whether the page that reply re-rendered
 * may be shown.
 *
 * A reply carries two things that are answered separately. The **return value** (or the error) always goes
 * back to the caller: the mutation ran, whatever happened to the screen since. The **page payload** is shown
 * only if it still describes the page on screen.
 */
import { createTemporaryReferenceSet, encodeReply, setServerCallback } from '@vitejs/plugin-rsc/browser';
import { createRscRequest } from '../request.js';
import { documentUrl } from './document.js';
import { handleControlDigest, push, supersedeActiveRequest } from './navigation.js';
import { discardPrepared, requestResource } from './page-resource.js';
import { createAttempt, pageVisits, schedule } from './render-attempt.js';
import { currentEntryKey } from './scroll.js';

/** Where a call was made from. A URL alone cannot tell the first visit to a page from a later one. */
const whereabouts = () => ({ document: documentUrl(), entry: currentEntryKey(), visits: pageVisits() });

let lastCall = 0;
/** The newest call whose page payload reached the screen. An older reply landing later is an older snapshot. */
let lastShown = 0;

export function installServerFunctions(): void {
  setServerCallback(async (id, args) => {
    const temporaryReferences = createTemporaryReferenceSet();
    const calledFrom = whereabouts();
    const call = ++lastCall;
    // Not wired to the request: nothing on the client may cancel a mutation's reply. Leaving the page loses
    // the right to *show* it, not the caller's right to its result.
    const controller = new AbortController();
    const request = createRscRequest(window.location.href, { id, body: await encodeReply(args, { temporaryReferences }) });
    const resource = requestResource(request, controller, temporaryReferences);

    let payload;
    try {
      payload = await resource.rootReady;
    } catch (error) {
      if (handleControlDigest(error, { history: 'push' })) return undefined;
      throw error;
    }

    if (payload.redirect) {
      void push(payload.redirect);
      return undefined;
    }

    const here = whereabouts();
    const samePage = here.document === calledFrom.document && here.entry === calledFrom.entry && here.visits === calledFrom.visits;
    if (samePage && call > lastShown) {
      lastShown = call;
      // The reply is newer than anything a navigation still on the wire could show: that fetch was answered
      // before the mutation, or raced it.
      supersedeActiveRequest();
      discardPrepared();
      void schedule(createAttempt(resource, payload, calledFrom.document, { recoversByLoad: false }));
    }

    // The action called `notFound()`: the reply *is* the notFound page, and there is no value to hand back.
    if (payload.notFound) return undefined;
    const result = payload.returnValue;
    if (!result) {
      throw new Error(
        '[rshono] the server action produced no result — the request failed around it and the server answered with a page instead. Its log has the error.',
      );
    }
    if (!result.ok) throw result.error;
    return result.value;
  });
}
