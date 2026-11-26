/**
 * How long a server render holds on to its request: the signal that aborts it, and the moment it lets go.
 * Shared by the page render and by a reply that carries only a function's result (`entry.rsc.tsx`); apart
 * from them so both halves can be driven without a server.
 */

/**
 * Passes `stream` through untouched, calling `done` once, however it ends: the source closing, the source
 * erroring, or the reader cancelling.
 *
 * `pipeTo` rather than a transformer's `flush` and `cancel`: those two are told about a close and a cancel
 * and are *not* told when the source errors, so a render that died left `done` uncalled. The promise
 * `pipeTo` returns settles on all three, exactly once, and it is the platform's own propagation — an error
 * goes forward to the reader, a cancel goes back to the source, and the identity transform's queue is the
 * only buffering, so a slow reader still slows the render. The same on Node and on Workers.
 */
export function releaseWhenDone(stream: ReadableStream<Uint8Array>, done: () => void): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  stream.pipeTo(writable).then(done, done);
  return readable;
}

/**
 * A signal for one render, aborted when the request is.
 *
 * React's renderers must never be handed the request's own signal: they add an `abort` listener and only remove it
 * if the abort fires, so on the happy path it stays on a request-lifetime signal and pins the whole rendered
 * tree. The render gets its own controller and the request signal forwards into it — `release` detaches on
 * the normal path. Not `AbortSignal.any()`, whose composite signals Node holds in a process-lifetime set
 * until they abort.
 */
export function renderSignal(requestSignal: AbortSignal): { renderAbort: AbortController; release: () => void } {
  const renderAbort = new AbortController();
  const forwardAbort = () => renderAbort.abort(requestSignal.reason);
  if (requestSignal.aborted) renderAbort.abort(requestSignal.reason);
  else requestSignal.addEventListener('abort', forwardAbort, { once: true });
  return { renderAbort, release: () => requestSignal.removeEventListener('abort', forwardAbort) };
}
