/**
 * One flight payload being read: the fetch (or the document's inlined stream), the root it resolves to, and
 * the single switch that stops it.
 *
 * A resource is made when the read starts and is the same object from then on — through the Navigation API's
 * precommit phase, into the React render that shows it, and for as long as that render stays on screen. Nothing
 * is re-created along the way: one read, one `AbortController`, one root promise.
 *
 * Who may stop it depends on who holds it:
 *
 * - **prepared** — being fetched, and not yet handed to React. Nothing reads its stream, so it is stopped the
 *   moment the navigation that asked for it is cancelled or replaced.
 * - **held** — handed to React, which may still be reading it: a payload's root resolves long before its
 *   stream ends, and the chunks that follow fill Suspense boundaries already on screen. Aborting one rejects
 *   those chunks into the tree. So a held resource is stopped only when a *different* render has committed
 *   and it is neither that render's nor the next one's — the first moment nothing can be reading it.
 */
import { createFromReadableStream } from '@vitejs/plugin-rsc/browser';
import type { RscPayload } from '../entry.rsc.js';
import { BUILD_HEADER, BuildMismatchError, isOtherBuild } from '../build-id.js';
import { createRscRequest } from '../request.js';

/**
 * What asked for the payload. It decides how a `redirect()` found in it treats history: a document's or a
 * navigation's payload names the URL that raised the redirect, so the redirect replaces that entry; an action
 * reply re-renders the page the visitor was already on, so its redirect is a push and Back returns there.
 */
export type ResourceKind = 'document' | 'navigation' | 'action';

export type PageResource = {
  readonly kind: ResourceKind;
  readonly url: URL;
  /** The only switch for this read. Inert for the document's inlined payload, which is not a request. */
  readonly controller: AbortController;
  /** The payload's root: enough to render the page's shell, and to learn of a redirect. */
  readonly rootReady: Promise<RscPayload>;
  /** Settles when the stream ends, however it ends — the root resolving is not the end. Never rejects. */
  readonly streamFinished: Promise<void>;
  /**
   * The token of the render that produced this payload, once its root has arrived. A `redirect()` raised
   * later in the same render carries it too, which is how an error React reports is traced back here.
   */
  renderToken?: string;
  /** Set once a route intent from this payload has been dealt with, so it is dealt with once. */
  intentSettled?: boolean;
};

/** What every flight response is typed as. The charset and any other parameters follow it. */
const FLIGHT_CONTENT_TYPE = 'text/x-component';

/** How much of a body that is not a payload is quoted back in the error. */
const REFUSAL_BODY_LIMIT = 200;

/**
 * The first {@link REFUSAL_BODY_LIMIT} characters of a response body, without buffering the rest.
 *
 * `response.text()` reads the whole body first, so a proxy's multi-megabyte error page would be buffered and
 * decoded before the 200 characters that are kept — on a path that exists to say what answered instead of a
 * payload. Reading one chunk at a time and cancelling stops paying for bytes nothing will look at.
 */
async function refusalBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < REFUSAL_BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` so a multi-byte character split across two reads is not replaced by U+FFFD.
      text += decoder.decode(value, { stream: true });
    }
    // Flush a trailing partial multi-byte sequence, so a body cut mid-character reads as U+FFFD rather than
    // dropping the bytes that were already read.
    text += decoder.decode();
  } catch {
    // A body that failed mid-read says no more than the status already did.
  } finally {
    void reader.cancel().catch(() => {});
  }
  return text.slice(0, REFUSAL_BODY_LIMIT).trim();
}

/**
 * Fetches a payload, refusing a response that is not one.
 *
 * The status cannot be the gate: a payload legitimately arrives as a 404 from the `notFound` page and as a
 * 500 from an action that threw, and both carry a real payload the caller has to see. The content type is.
 *
 * What this catches is the response that is not a payload at all — a `bodyLimit()` 413, a proxy's error page,
 * a 502 mid-deploy. Handed to the flight parser those all surface as `Error: Connection closed.`, with the
 * status and the body nowhere in sight; here they become an error that says what arrived.
 */
async function payloadResponse(request: Request): Promise<Response> {
  const response = await fetch(request);
  // Before the body is looked at, whatever it is: a payload from another build names chunks this page
  // cannot load, and a refusal from one is not a payload at all. Nothing of it reaches the decoder.
  const theirs = response.headers.get(BUILD_HEADER);
  if (isOtherBuild(theirs)) {
    void response.body?.cancel().catch(() => {});
    throw new BuildMismatchError(theirs!);
  }
  const contentType = response.headers.get('content-type');
  if (contentType?.startsWith(FLIGHT_CONTENT_TYPE)) return response;
  // Read for the message: a plain-text refusal says what it refused only in its body, and HTTP/2 has no
  // `statusText` at all. Bounded, because this is an error path and the body is not ours to trust.
  const body = await refusalBody(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  throw new Error(`[rsvhono] the server answered ${status} (${contentType ?? 'no content type'}) instead of a payload${body ? `: ${body}` : ''}`);
}

declare global {
  /** The array the payload `<script>` tags `flight-inject.ts` emits push their chunks into. */
  var __FLIGHT_DATA: Array<string | Uint8Array> | undefined;
}

/** The flight payload the document carried, read back out of `__FLIGHT_DATA` — see `flight-inject.ts`. */
function readInlinePayload(): ReadableStream<Uint8Array> {
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

/**
 * `source` as a stream whose ending is observable, without a second reader: a `tee()` would hold every chunk
 * in memory twice for as long as either branch lagged, to learn one fact.
 */
function observed(source: Promise<ReadableStream<Uint8Array>>): { stream: ReadableStream<Uint8Array>; finished: Promise<void> } {
  const { promise: finished, resolve } = Promise.withResolvers<void>();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled: { reason: unknown } | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!reader) {
          const body = await source;
          // Cancelled while the response was still on its way: there was no reader to cancel then, so the
          // body that has just arrived is released here instead of being read by nobody.
          if (cancelled) return void body.cancel(cancelled.reason).catch(() => {});
          reader = body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          resolve();
        } else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        resolve();
      }
    },
    cancel(reason) {
      cancelled = { reason };
      resolve();
      return reader?.cancel(reason);
    },
  });
  return { stream, finished };
}

function createResource(
  kind: ResourceKind,
  url: URL,
  controller: AbortController,
  source: Promise<ReadableStream<Uint8Array>>,
  temporaryReferences?: unknown,
): PageResource {
  const { stream, finished } = observed(source);
  const rootReady = Promise.resolve(createFromReadableStream<RscPayload>(stream, { temporaryReferences }));
  // A resource nobody ends up waiting on — a navigation cancelled mid-fetch — must not surface as an
  // unhandled rejection. Whoever does await `rootReady` still sees it reject.
  rootReady.catch(() => {});
  const resource: PageResource = { kind, url, controller, rootReady, streamFinished: finished };
  void rootReady.then(
    (payload) => {
      resource.renderToken = payload.renderToken;
    },
    () => {},
  );
  return resource;
}

const emptyBody = (): ReadableStream<Uint8Array> => new ReadableStream({ start: (controller) => controller.close() });

/** Starts reading the payload `request` answers with. The request must carry `controller.signal`. */
export function requestResource(kind: ResourceKind, request: Request, controller: AbortController, temporaryReferences?: unknown): PageResource {
  const body = payloadResponse(request).then((response) => response.body ?? emptyBody());
  return createResource(kind, new URL(request.url), controller, body, temporaryReferences);
}

/** The payload the server inlined into this document. Already here, so there is nothing for an abort to stop. */
export function inlineResource(): PageResource {
  return createResource('document', new URL(location.href), new AbortController(), Promise.resolve(readInlinePayload()));
}

// ── Ownership ────────────────────────────────────────────────────────────────────────────────────────────

const prepared = new Set<PageResource>();
const held = new Set<PageResource>();
let report: (preparing: boolean) => void = () => {};

function changed(): void {
  report(prepared.size !== 0);
}

/**
 * Reports whether a navigation is fetching a payload React has not been given yet — the half of
 * `useNavigation().router.pending` that no React transition covers, because nothing has been scheduled.
 *
 * A callback into ordinary state rather than `useSyncExternalStore`: a store that changes while a transition
 * is rendering makes React redo that render synchronously, and this one changes exactly then — when a
 * navigation's fetch is handed over.
 */
export function watchPreparing(listener: (preparing: boolean) => void): () => void {
  report = listener;
  listener(prepared.size !== 0);
  return () => {
    if (report === listener) report = () => {};
  };
}

/**
 * Starts fetching the page payload for `href`, as a prepared resource. `navigation`, when given, is the
 * signal of the browser navigation that wants it: cancelled before React has the payload, the fetch stops
 * with it. Afterwards the signal no longer applies — see the ownership rules at the top of this file.
 * `cache` is the fetch's cache mode, for a re-read that must not be answered from the HTTP cache.
 */
export function prepare(href: string, navigation?: AbortSignal, cache?: RequestCache): PageResource {
  const controller = new AbortController();
  const url = new URL(href, location.href);
  const resource = requestResource('navigation', createRscRequest(url.href, undefined, controller.signal, cache), controller);
  prepared.add(resource);
  changed();
  const cancel = () => {
    if (prepared.has(resource)) discard(resource, navigation?.reason);
  };
  if (navigation?.aborted) cancel();
  else navigation?.addEventListener('abort', cancel, { once: true });
  // However the read ends, the navigation's signal has nothing left to cancel.
  void resource.streamFinished.then(() => navigation?.removeEventListener('abort', cancel));
  return resource;
}

/** Stops a prepared resource and forgets it. A no-op for one React already holds. */
export function discard(resource: PageResource, reason?: unknown): void {
  if (!prepared.delete(resource)) return;
  resource.controller.abort(reason);
  changed();
}

/** Stops every prepared resource: a newer navigation, or an action's reply, has taken the screen. */
export function discardPrepared(): void {
  for (const resource of [...prepared]) discard(resource);
}

/** Hands a resource to React. From here only {@link retire} stops it. */
export function hold(resource: PageResource): void {
  held.add(resource);
  if (prepared.delete(resource)) changed();
  // A stream that has ended has nothing left to stop, and no reason to be remembered.
  void resource.streamFinished.then(() => held.delete(resource));
}

/**
 * The one live resource whose payload came from the render `renderToken` names — or `undefined` when there is
 * none, and also when there are several: a cached payload can be read twice, and which read an error belongs
 * to is then not something the token says. The caller treats both as "source unknown".
 *
 * `rendering` is what React has been given — the attempt on screen and the one scheduled — which is looked at
 * as well because a resource leaves `held` when its stream ends, and a payload's last error can reach React
 * after that. Nothing is kept for any of this: the token is a field of the resource, so it is forgotten when
 * the resource is.
 */
export function resourceOfRender(renderToken: string, rendering: Array<PageResource | undefined>): PageResource | undefined {
  let found: PageResource | undefined;
  for (const resource of new Set([...rendering, ...held, ...prepared])) {
    if (resource?.renderToken !== renderToken) continue;
    if (found) return undefined;
    found = resource;
  }
  return found;
}

/** Stops every held resource `stillRead` does not vouch for. Called when a render commits. */
export function retire(stillRead: (resource: PageResource) => boolean): void {
  for (const resource of [...held]) {
    if (stillRead(resource)) continue;
    held.delete(resource);
    resource.controller.abort();
  }
}
