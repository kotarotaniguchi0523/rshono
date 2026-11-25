// Unit tests for the pure pieces — the parsers, path maths and header helpers the e2e suite only
// exercises indirectly through one happy path. They import the *built* package, so they double as a
// check that dist is importable from plain Node.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanPageFiles } from '../dist/builder/page-files.js';
import { checkReactVersions } from '../dist/builder/react-versions.js';
import { readsGlobalProcess, shadowProcessEnv } from '../dist/builder/env-shadow.js';
import { createViteConfig } from '../dist/builder/vite-config.js';
import { DEPLOY_TARGETS, deployHintFor, NODE_PRESET, resolveDeployPreset } from '../dist/deploy/presets.js';
import { publicRouteCollisions } from '../dist/deploy/public-paths.js';
import { appendVary, etagMatches, varyWith } from '../dist/server/headers.js';
import { loadConfig } from '../dist/server/load-config.js';
import { parsePort, resolveServerConfig } from '../dist/server/server-config.js';
import { createPageCache, PRERENDER_NONCE_HEADER, setPrerenderFlight, ssgAssetPath, ssgFilePath } from '../dist/server/prerendered.js';
import { prerenderStaticRoutes, readPrerendered, resolveSiteOrigin } from '../dist/server/ssg.js';
import { injectFlightPayload } from '../dist/runtime/flight-inject.js';
import { asksForRsc, createRscRequest, isActionRequest, isBrowserFormPost, parseRenderRequest, wantsRsc } from '../dist/runtime/request.js';
import {
  controlDigestFor,
  isControlDigest,
  NotFoundSignal,
  parseControlIntent,
  parseRedirectDigest,
  RedirectSignal,
} from '../dist/runtime/control.js';
import {
  beginPageRender,
  getRequestContext,
  onServerError,
  publicUrl,
  reportServerError,
  RequestContext,
  runWithContext,
} from '../dist/runtime/context.js';
import { assertRouteModules, validateRoutesModule, validateServerApp } from '../dist/runtime/validate-entries.js';
import { MINIMAL_APP_DIR, TESTBED_DIR } from './helpers.mjs';

const tempDirs = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rsvhono-unit-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('injectFlightPayload', () => {
  const encoder = new TextEncoder();
  const streamOf = (chunks) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
        controller.close();
      },
    });

  async function readAll(stream) {
    const decoder = new TextDecoder();
    let html = '';
    for await (const chunk of stream) html += decoder.decode(chunk, { stream: true });
    return html + decoder.decode();
  }

  /** Fails loudly instead of hanging the suite: a transformer that never settles is exactly the bug below. */
  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref())]);
  }

  function inject(htmlChunks, { nonce } = {}) {
    return readAll(streamOf(htmlChunks).pipeThrough(injectFlightPayload(streamOf(['0:"hi"\n']), nonce ? { nonce } : {})));
  }

  const countOf = (html, needle) => html.split(needle).length - 1;

  // React's byte writer packs output into 2 kB views and splits any write that straddles one, so the
  // document trailer can arrive as two chunks. `rsc-html-stream/server` tests each chunk with
  // `endsWith` and misses that, emitting two trailers with the payload script after the first — i.e.
  // outside <body>. A page's byte layout is deterministic, so such a page is malformed every time.
  const splits = {
    'one chunk': ['<html><body><p>hi</p>', '</body></html>'],
    'mid-tag': ['<html><body><p>hi</p></bo', 'dy></html>'],
    'between tags': ['<html><body><p>hi</p></body>', '</html>'],
    'one byte early': ['<html><body><p>hi</p></body></htm', 'l>'],
    'byte at a time': ['<html><body><p>hi</p>', ...'</body></html>'],
  };

  for (const [name, chunks] of Object.entries(splits)) {
    test(`holds back a document trailer split ${name}`, async () => {
      const html = await inject(chunks);
      assert.equal(countOf(html, '</body></html>'), 1, 'exactly one trailer, however React chunked it');
      assert.equal(countOf(html, '__FLIGHT_DATA'), 1, 'the payload rides in one script');
      assert.match(html, /<script>\(self\.__FLIGHT_DATA\|\|=\[\]\)\.push\("0:\\"hi\\"\\n"\)<\/script><\/body><\/html>$/);
    });
  }

  // The five splits above all land in one batch: they are enqueued synchronously, so the boundary macrotask
  // has not run between them. This one puts a real macrotask between the halves, which is the only shape
  // `emitBatch` can miss — it tests the joined batch, and a tail is what carries the miss across batches.
  // React does not produce it (its final flush is one synchronous run), but this injector exists precisely
  // because `rsc-html-stream` made a narrower version of that same assumption, so it is guarded rather than
  // asserted about React.
  test('holds back a document trailer split across two batches', async () => {
    /** One chunk per batch: the wait is long enough that the injector's boundary has fired in between. */
    const batchedStreamOf = (chunks) => {
      let next = 0;
      return new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (next >= chunks.length) controller.close();
          else controller.enqueue(encoder.encode(chunks[next++]));
        },
      });
    };

    const html = await readAll(batchedStreamOf(['<html><body><p>hi</p></bo', 'dy></html>']).pipeThrough(injectFlightPayload(streamOf(['0:"hi"\n']))));
    assert.equal(countOf(html, '</body></html>'), 1, 'exactly one trailer, however the batches fell');
    assert.ok(html.indexOf('__FLIGHT_DATA') < html.indexOf('</body></html>'), 'the script must not land inside the trailer');
    assert.match(html, /<script>\(self\.__FLIGHT_DATA\|\|=\[\]\)\.push\("0:\\"hi\\"\\n"\)<\/script><\/body><\/html>$/);

    // The other half of holding a tail back: one that never completes still has to come back out. It comes
    // out *after* the payload scripts, which is deliberate — releasing it as soon as a script wants to go out
    // is exactly the bug above, since the next batch may be the rest of the trailer. Only a truncated
    // document can reach this, it is 13 bytes at most, and they stay inside `<body>`.
    const stump = await readAll(batchedStreamOf(['<html><body>a</bod']).pipeThrough(injectFlightPayload(streamOf(['0:"hi"\n']))));
    assert.match(stump, /^<html><body>a<script>.*<\/script><\/bod<\/body><\/html>$/, 'a tail that was not a trailer is not lost');
  });

  test('puts the payload script inside the body, before the trailer', async () => {
    const html = await inject(['<html><body><p>hi</p></body></html>']);
    assert.ok(html.indexOf('__FLIGHT_DATA') < html.indexOf('</body></html>'), 'the script must not land after </body>');
  });

  test('carries the CSP nonce on the injected script', async () => {
    const html = await inject(['<html><body></body></html>'], { nonce: 'abc123' });
    assert.match(html, /<script nonce="abc123">/);
    // Base64url too — a generator may emit either alphabet, and `=` padding.
    const urlSafe = await inject(['<html><body></body></html>'], { nonce: 'aB-_0z==' });
    assert.match(urlSafe, /<script nonce="aB-_0z==">/);
  });

  test('drops a nonce that is not one rather than writing it into the tag', async () => {
    // This tag is built by hand, so its attribute value is the one in a rendered document that nothing else
    // escapes. The value is not attacker-controlled today — it comes from Hono's `secureHeaders()` — but the
    // framework does not own where it comes from: `secureHeadersNonce` is an ordinary context variable any
    // middleware can set. A `"` in it would close the attribute and open a script-injection point in every
    // page. Dropped rather than escaped: a value that is not a nonce is not one, and a payload script the
    // policy then refuses is the visible failure to have.
    for (const nonce of ['" onload="alert(1)', 'abc"><script>alert(1)</script>', 'has space', 'weird;value', '<>']) {
      const html = await inject(['<html><body></body></html>'], { nonce });
      assert.match(html, /<script>\(self\.__FLIGHT_DATA/, `"${nonce}" must not reach the tag`);
      assert.equal(countOf(html, 'nonce'), 0, `"${nonce}" was written into the document`);
    }
  });

  test('escapes a payload that would close the script element early', async () => {
    const out = streamOf(['<html><body></body></html>']).pipeThrough(injectFlightPayload(streamOf(['0:"</script><!--x"\n'])));
    const decoder = new TextDecoder();
    let html = '';
    for await (const chunk of out) html += decoder.decode(chunk, { stream: true });
    html += decoder.decode();
    assert.equal(countOf(html, '</script>'), 1, 'only the real closing tag');
    assert.match(html, /<\/\\script>/, 'the payload copy is escaped');
    assert.match(html, /<\\!--/);
  });

  // The `atob` fallback is how a binary row — a `Uint8Array` a server component handed a client one —
  // survives the trip through a `<script>` tag. Reassembles the payload the way `entry.client.tsx` does,
  // by running the emitted script bodies against a `__FLIGHT_DATA` shim, and asserts the bytes are the
  // bytes that went in.
  async function replayPayload(payloadChunks) {
    const out = streamOf(['<html><body>hi</body></html>']).pipeThrough(injectFlightPayload(streamOf(payloadChunks)));
    const html = await readAll(out);
    const parts = [];
    for (const [, body] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      new Function('self', body)({ __FLIGHT_DATA: { push: (chunk) => parts.push(chunk) } });
    }
    return Buffer.concat(parts.map((part) => Buffer.from(typeof part === 'string' ? encoder.encode(part) : part)));
  }

  test('carries binary payload bytes through the document byte-exactly', async () => {
    // The chunk boundary is the hazard: a payload cut mid-character used to leave its lead bytes inside a
    // streaming decoder, and the next chunk's `atob` fallback — which re-encodes only the chunk that threw —
    // dropped them. The client then reassembled a payload short by those bytes and failed to hydrate.
    const payload = Buffer.from('303a22e282ac220a313afffe0a', 'hex');
    const got = await replayPayload([payload.subarray(0, 5), payload.subarray(5)]);
    assert.deepEqual(got, payload, 'the client must read back exactly the bytes the server wrote');
  });

  test('captures the raw Flight chunks byte-exactly', async () => {
    const chunks = [encoder.encode('0:"hi"\n'), Buffer.from('313afffe0a', 'hex')];
    const injected = injectFlightPayload(streamOf(chunks), { captureFlight: true });
    await readAll(streamOf(['<html><body></body></html>']).pipeThrough(injected));

    assert.deepEqual(Buffer.from(await injected.capturedFlight), Buffer.concat(chunks));
  });

  test('keeps a byte-order mark that opens a payload chunk', async () => {
    // Decoding per chunk re-runs the BOM check on every call, so the decoder is `ignoreBOM`.
    const payload = Buffer.from('efbbbf41', 'hex');
    assert.deepEqual(await replayPayload([payload]), payload);
  });

  test('completes the response when the payload ends mid-character', async () => {
    // The end-of-stream flush on a `fatal` decoder holding an incomplete sequence threw from outside any
    // `try`, and the rejection errored the response stream: a truncated document with no trailer.
    const out = streamOf(['<html><body>hi</body></html>']).pipeThrough(
      injectFlightPayload(streamOf([encoder.encode('0:"hi"\n'), Uint8Array.from([0x31, 0x3a, 0x22, 0xe2])])),
    );
    const html = await readAll(out);
    assert.equal(countOf(html, '</body></html>'), 1, 'the document still has to be closed');
  });

  test('re-emits a trailer even when the document never had one', async () => {
    const html = await inject(['<p>fragment</p>']);
    assert.equal(countOf(html, '</body></html>'), 1);
  });

  test('ends the response even when the HTML side produced no chunks at all', async () => {
    // `transform` is what starts the payload write and so what eventually settles the promise `flush` awaits.
    // An HTML stream that closes having emitted nothing never reaches it, and `flush` used to park on that
    // promise forever — a response held open rather than ended, with `onDone` never firing to release the
    // abort forwarder that retains the rendered tree.
    let released = false;
    const out = streamOf([]).pipeThrough(injectFlightPayload(streamOf(['0:"hi"\n']), { onDone: () => (released = true) }));

    const html = await withTimeout(readAll(out), 2000, 'flush never resolved for a zero-chunk HTML stream');
    assert.match(html, /__FLIGHT_DATA/, 'the payload the client hydrates from still has to be written');
    assert.equal(countOf(html, '</body></html>'), 1, 'and the document still has to be closed');
    assert.ok(released, 'onDone must fire, however the response ended');
  });

  // The client-disconnect path. @hono/node-server cancels the response reader when the socket's
  // writable closes, and a page whose flight payload outlives its HTML — a suspended server component
  // resolving after the shell has flushed — puts that cancel inside `flush`'s `await flightWritten`.
  //
  // The trap is that the transformer's `cancel` hook does *not* run there: per the Streams standard,
  // cancelling the readable once the close algorithm has started returns the pending finish promise
  // without performing the cancel. So the enqueue that follows throws `ERR_INVALID_STATE` out of an
  // async transformer callback, where nothing owns the rejection — and `onDone` never fires, which is
  // what `renderComponent` relies on to detach the abort forwarder holding the rendered tree.
  describe('when the client disconnects mid-response', () => {
    /** A flight stream that stays open until `release()`, so `flush` is parked when the cancel lands. */
    function heldFlightStream() {
      let release;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('0:"hi"\n'));
          release = () => controller.close();
        },
      });
      return { stream, release: () => release() };
    }

    test('cancelling while the flight payload is still open resolves, releases and does not throw', async () => {
      const rejections = [];
      const onRejection = (error) => rejections.push(error);
      process.on('unhandledRejection', onRejection);
      try {
        const flight = heldFlightStream();
        let rscCancelled = false;
        // Interposed so the test can see whether the RSC branch is torn down: left un-cancelled it
        // keeps being pumped for a response nobody will read, and a tee's other half buffers for it.
        const watched = new ReadableStream({
          start: async (c) => {
            const reader = flight.stream.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              try {
                c.enqueue(value);
              } catch {
                break;
              }
            }
            try {
              c.close();
            } catch {
              /* already gone */
            }
          },
          cancel: () => {
            rscCancelled = true;
          },
        });

        let released = 0;
        const injected = injectFlightPayload(watched, { onDone: () => released++, captureFlight: true });
        const out = streamOf(['<html><body><p>hi</p></body></html>']).pipeThrough(injected);
        const reader = out.getReader();
        await reader.read(); // the shell; the trailer is held back and `flush` is now parked

        const reason = new Error('Client connection prematurely closed.');
        await reader.cancel(reason);
        await assert.rejects(injected.capturedFlight, /Client connection prematurely closed/);
        flight.release();
        await new Promise((resolve) => setTimeout(resolve, 50));

        assert.equal(released, 1, 'onDone must fire, or the abort forwarder is never detached');
        assert.equal(rscCancelled, true, 'the RSC branch must be released rather than left to be pumped');
        assert.deepEqual(rejections, [], 'a disconnect must not produce an unhandled rejection');
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });

    test('cancelling after the payload is written still reports done exactly once', async () => {
      let released = 0;
      const out = streamOf(['<html><body></body></html>']).pipeThrough(injectFlightPayload(streamOf(['0:"hi"\n']), { onDone: () => released++ }));
      for await (const _chunk of out) void _chunk;
      assert.equal(released, 1);
    });
  });

  // A slow client must park the producers rather than let them run to completion into the readable's queue.
  // The payload pump is the half that had no gate at all: it writes into the transform's controller from a
  // detached promise, so nothing about the transform's own backpressure applied to it.
  test('stops producing while the consumer is not reading', async () => {
    let htmlPulled = 0;
    let flushes = 0;
    // Shaped like React: a run of chunks per flush, flushes separated by a macrotask.
    const html = new ReadableStream({
      async pull(controller) {
        if (htmlPulled % 5 === 0) {
          flushes++;
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (++htmlPulled > 500) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode('<p>hi</p>'));
      },
    });
    let flightPulled = 0;
    const flight = new ReadableStream({
      pull(controller) {
        if (++flightPulled > 500) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${flightPulled}:"hi"\n`));
      },
    });

    const reader = html.pipeThrough(injectFlightPayload(flight)).getReader();
    await reader.read(); // one chunk, then stall — a client that stopped reading
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(flightPulled < 10, `the payload must park, not run to completion (pulled ${flightPulled})`);
    assert.ok(htmlPulled < 20, `the document must park, not run to completion (pulled ${htmlPulled})`);
    assert.ok(flushes >= 1, 'sanity: the source did produce');

    // And reading again has to resume it, rather than having deadlocked on a permit nobody releases.
    const before = flightPulled;
    for (let i = 0; i < 20; i++) await reader.read();
    assert.ok(flightPulled > before, 'reading again must resume the payload');
    await reader.cancel();
  });

  test('does not drain a large captured payload ahead of a slow HTML consumer', async () => {
    const chunks = Array.from({ length: 500 }, (_, index) => {
      const chunk = new Uint8Array(1024);
      chunk.fill(index % 256);
      return chunk;
    });
    let flightPulled = 0;
    const flight = new ReadableStream({
      pull(controller) {
        if (flightPulled === chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[flightPulled++]);
      },
    });
    const injected = injectFlightPayload(flight, { captureFlight: true });
    const reader = streamOf(['<html><body></body></html>']).pipeThrough(injected).getReader();

    await reader.read();
    let captureFinished = false;
    void injected.capturedFlight.then(() => {
      captureFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(flightPulled < 10, `capture must follow downstream demand, not drain all ${chunks.length} chunks (pulled ${flightPulled})`);
    assert.equal(captureFinished, false, 'capture must remain pending while downstream demand is stalled');

    while (!(await reader.read()).done) {
      // Drain the simulated slow consumer one chunk at a time.
    }
    assert.deepEqual(Buffer.from(await injected.capturedFlight), Buffer.concat(chunks));
  });
});

// Two fields, because only two things here are decided by the build. The CSRF check, the CSP and the
// body cap used to live alongside them and are now Hono middleware an app registers in src/server.ts
// — see prod-config.test.mjs, which exercises them over HTTP rather than through a resolver.
// The ambient context, which every `getRequestContext()` call in an app resolves through. Sequential tests
// cannot see the failure that matters here: one request reading another's context.
describe('runWithContext', () => {
  const contextFor = (path) => ({ req: { url: `http://example.test${path}`, param: () => ({}) }, env: {} });

  test('keeps one context per flow across suspensions', async () => {
    const seen = [];
    /** Reads the ambient context either side of an await, so what is asserted is that the store survives one. */
    const flow = (path, delay) =>
      runWithContext(contextFor(path), async () => {
        const before = getRequestContext().url.pathname;
        await new Promise((resolve) => setTimeout(resolve, delay));
        const after = getRequestContext().url.pathname;
        seen.push({ path, before, after });
      });

    // Interleaved deliberately: the longest-running flow starts first and finishes last, so every other
    // flow enters and leaves inside it.
    await Promise.all([flow('/a', 30), flow('/b', 5), flow('/c', 15), flow('/d', 0)]);

    assert.equal(seen.length, 4);
    for (const { path, before, after } of seen) {
      assert.equal(before, path, `${path} read the wrong context before its await`);
      assert.equal(after, path, `${path} read the wrong context after its await — another flow's store leaked in`);
    }
  });

  test('throws outside a flow rather than resolving to the last one that ran', () => {
    assert.throws(() => getRequestContext(), /outside a request/);
  });

  test('hands back the same wrapper for the same request, and a different one for another', () => {
    const c = contextFor('/a');
    const [first, second] = runWithContext(c, () => [getRequestContext(), getRequestContext()]);
    assert.equal(first, second, 'memoised per request, so repeated calls are one object');
    assert.notEqual(runWithContext(contextFor('/a'), getRequestContext), first, 'and never shared between requests');
  });
});

// The single funnel every caught server-side error goes through. `prod.test.mjs` covers the happy path over
// HTTP; these are the parts an app only meets when something else has already gone wrong.
describe('reportServerError', () => {
  const hono = { req: { raw: new Request('http://example.test/boom') } };
  const report = (error, source = 'request') => reportServerError(error, { source, hono, message: '[rsvhono] test:' });

  /** Runs `body` with `console.error` collected rather than printed — every report writes one. */
  function withStderr(body) {
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.map(String).join(' '));
    try {
      body(lines);
    } finally {
      console.error = original;
    }
    return lines;
  }

  // Registered handlers are module state with no way to unregister, so every test sets its own and the
  // last one leaves a no-op behind.
  after(() => onServerError(() => {}));

  test('hands the handler the source, the request and the Hono context, and still writes to stderr', () => {
    const seen = [];
    onServerError((error, context) => seen.push({ error, ...context }));
    const lines = withStderr(() => report(new Error('boom'), 'action'));

    assert.equal(seen.length, 1);
    assert.equal(seen[0].source, 'action');
    assert.equal(seen[0].error.message, 'boom');
    assert.equal(seen[0].request.url, 'http://example.test/boom', 'the request is derived from the context');
    assert.equal(seen[0].hono, hono);
    assert.equal(typeof seen[0].waitUntil, 'function');
    assert.match(lines.join('\n'), /\[rsvhono\] test:/, 'a handler must not replace the stderr log');
  });

  test('reports one fault once, however many stages catch it', () => {
    const seen = [];
    onServerError((_error, { source }) => seen.push(source));
    withStderr(() => {
      const error = new Error('one fault');
      // What a thrown server action does: reported where it is known to be an action, then re-thrown, which
      // lands it in the top-level handler as well. Two sources for one fault is worse than only the outer.
      report(error, 'action');
      report(error, 'request');
    });
    assert.deepEqual(seen, ['action'], 'the first stage to recognise it wins — it is the one that knows what it was');
  });

  test('reports a primitive throw wherever it is caught, having nothing to track it by', () => {
    const seen = [];
    onServerError((_error, { source }) => seen.push(source));
    withStderr(() => {
      report('a string', 'render');
      report('a string', 'request');
    });
    assert.deepEqual(seen, ['render', 'request'], 'a primitive cannot go in a WeakSet, so it is reported twice');
  });

  test('a handler that throws is caught and logged, and does not fail the request', () => {
    onServerError(() => {
      throw new Error('the tracker is down');
    });
    const lines = withStderr(() => {
      assert.doesNotThrow(() => report(new Error('boom')), 'reporting can never be what fails a request');
    });
    assert.match(lines.join('\n'), /the onServerError handler threw/);
    assert.match(lines.join('\n'), /the tracker is down/, 'and the handler’s own error is not swallowed');
  });

  test('registering again replaces the previous handler', () => {
    const calls = [];
    onServerError(() => calls.push('first'));
    onServerError(() => calls.push('second'));
    withStderr(() => report(new Error('boom')));
    assert.deepEqual(calls, ['second'], 'one funnel, not a growing list');
  });

  test('waitUntil is a no-op where the platform has no execution context, and swallows a rejection', async () => {
    // `c.executionCtx` *throws* rather than answering undefined, so a handler reaching for it itself would
    // have its report swallowed by the guard above — on exactly the platforms where nothing needed holding
    // open. And an unhandled rejection from a report must not be what ends the process.
    const rejections = [];
    const onRejection = (error) => rejections.push(error);
    process.on('unhandledRejection', onRejection);
    // Captured across the await rather than with `withStderr`: the rejection is logged a tick after the
    // report returns, which is exactly the window that helper closes.
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.map(String).join(' '));
    try {
      onServerError((_error, { waitUntil }) => {
        assert.doesNotThrow(() => waitUntil(Promise.resolve('sent')));
        waitUntil(Promise.reject(new Error('the tracker refused it')));
      });
      report(new Error('boom'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(rejections, [], 'a failed report must not surface as an unhandled rejection');
      assert.match(lines.join('\n'), /waitUntil rejected/);
      assert.match(lines.join('\n'), /the tracker refused it/);
    } finally {
      console.error = original;
      process.off('unhandledRejection', onRejection);
    }
  });
});

// Every branch here ends in a message someone reads while a build is failing, and only the happy path of
// `--config` was covered — indirectly, by `prod-config.test.mjs` building with a fixture config.
describe('loadConfig', () => {
  test('returns an empty config where the project has none', async () => {
    assert.deepEqual(await loadConfig(tempDir()), {}, 'no config file is not an error — every field has a default');
  });

  test('finds rsvhono.config.{ts,js,mjs} at the root, in that order', async () => {
    for (const [name, marker] of [
      ['rsvhono.config.ts', 'ts'],
      ['rsvhono.config.js', 'js'],
      ['rsvhono.config.mjs', 'mjs'],
    ]) {
      const dir = tempDir();
      writeFileSync(join(dir, name), `export default { siteUrl: 'https://${marker}.example' };\n`);
      assert.equal((await loadConfig(dir)).siteUrl, `https://${marker}.example`, `${name} must be found`);
    }

    // Precedence, so a leftover file cannot quietly win: .ts first.
    const dir = tempDir();
    writeFileSync(join(dir, 'rsvhono.config.mjs'), "export default { siteUrl: 'https://mjs.example' };\n");
    writeFileSync(join(dir, 'rsvhono.config.ts'), "export default { siteUrl: 'https://ts.example' };\n");
    assert.equal((await loadConfig(dir)).siteUrl, 'https://ts.example');
  });

  test('names an explicit --config that is not there, rather than failing later', async () => {
    const missing = join(tempDir(), 'nope.config.mjs');
    await assert.rejects(loadConfig(tempDir(), missing), /\[rsvhono\] config file not found: /);
  });

  test('resolves a relative --config against the working directory', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'custom.config.mjs'), "export default { siteUrl: 'https://custom.example' };\n");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      assert.equal((await loadConfig(tempDir(), 'custom.config.mjs')).siteUrl, 'https://custom.example');
    } finally {
      process.chdir(cwd);
    }
  });

  test('says a config with no default export is missing one', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'rsvhono.config.mjs'), "export const config = { siteUrl: 'https://x.example' };\n");
    await assert.rejects(loadConfig(dir), /must `export default` a config object/);
  });

  // The bespoke branch: Node strips types itself, and the one thing it will not do is rewrite a `.js`
  // specifier to the `.ts` file beside it. Without the hint this surfaces as a raw ERR_MODULE_NOT_FOUND
  // naming a path that does exist — as a .ts file.
  test("explains a .ts config importing a sibling by its '.js' specifier", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'shared.ts'), 'export const siteUrl = "https://shared.example";\n');
    writeFileSync(join(dir, 'rsvhono.config.ts'), "import { siteUrl } from './shared.js';\nexport default { siteUrl };\n");
    await assert.rejects(loadConfig(dir), (error) => {
      assert.match(error.message, /imports a module Node could not resolve/);
      assert.match(error.message, /does not rewrite a \.js specifier/);
      assert.equal(error.cause?.code, 'ERR_MODULE_NOT_FOUND', 'the original is kept as the cause');
      return true;
    });

    // And the same import by its real extension loads, so the advice is advice that works. In a directory
    // of its own: Node's module registry keeps the failed load above under its URL, so rewriting the file
    // in place would re-throw it.
    const fixed = tempDir();
    writeFileSync(join(fixed, 'shared.ts'), 'export const siteUrl = "https://shared.example";\n');
    writeFileSync(join(fixed, 'rsvhono.config.ts'), "import { siteUrl } from './shared.ts';\nexport default { siteUrl };\n");
    assert.equal((await loadConfig(fixed)).siteUrl, 'https://shared.example');
  });

  test('lets any other import failure through as itself', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'rsvhono.config.mjs'), 'throw new Error("config blew up");\n');
    await assert.rejects(loadConfig(dir), /config blew up/, 'a config that throws must not be dressed up as a resolution hint');
  });
});

// The browser-facing URL, which is what `csrf()` and every absolute link the app builds depend on. Reached
// only through `prod-config.test.mjs`'s `csrf()` assertions until now, so the pieces below — a forwarded
// chain, a forwarded host with no port, a host that is not one — were covered end to end at best and not at
// all in the cases the e2e app does not send.
describe('publicUrl', () => {
  /** The two members `publicUrl` reads, and nothing else, so the test says what it depends on. */
  const request = (url, headers = {}) => ({ req: { url, header: (name) => headers[name.toLowerCase()] } });

  test('ignores the forwarded headers when trustProxy is off', () => {
    const url = publicUrl(request('http://127.0.0.1:3000/a?b=1', { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }));
    assert.equal(url.href, 'http://127.0.0.1:3000/a?b=1', 'the default must be the address the server was reached on');
  });

  describe('with trustProxy on', () => {
    // The flag is a module-level const read from the `DefinePlugin` global when the module is first
    // evaluated, so the only way to reach the other branch is a fresh module instance with the global
    // already set. The query string is what makes the import fresh.
    let trusted;
    before(async () => {
      globalThis.__RSVHONO_CONFIG__ = { trustProxy: true, isDev: false };
      trusted = (await import('../dist/runtime/context.js?trustProxy=1')).publicUrl;
    });
    after(() => {
      delete globalThis.__RSVHONO_CONFIG__;
    });

    test('takes the host and scheme the browser used, and drops the internal port', () => {
      // The port is the subtle one: assigning `url.host` would keep :3000 when the new value has none,
      // which is why the implementation parses instead. Asserted end to end once; never in isolation.
      const url = trusted(request('http://127.0.0.1:3000/a?b=1', { 'x-forwarded-host': 'example.com', 'x-forwarded-proto': 'https' }));
      assert.equal(url.href, 'https://example.com/a?b=1');
    });

    test('keeps a port the forwarded host names', () => {
      const url = trusted(request('http://127.0.0.1:3000/', { 'x-forwarded-host': 'example.com:8443', 'x-forwarded-proto': 'https' }));
      assert.equal(url.href, 'https://example.com:8443/');
    });

    test('honours the first hop of a proxy chain, which is the client-facing one', () => {
      const url = trusted(
        request('http://127.0.0.1:3000/', { 'x-forwarded-host': 'example.com, inner.local:8080', 'x-forwarded-proto': 'https, http' }),
      );
      assert.equal(url.href, 'https://example.com/', 'a chain appends, so the browser-facing value is the first entry');
    });

    test('leaves the URL alone where a header is not usable', () => {
      const internal = 'http://127.0.0.1:3000/a';
      // A host no URL can hold, an empty value, and a scheme a browser could not have requested. Each
      // leaves that half of the URL as it was rather than throwing or guessing.
      assert.equal(trusted(request(internal, { 'x-forwarded-host': 'a b' })).href, internal, 'an unparseable host');
      assert.equal(trusted(request(internal, { 'x-forwarded-host': '  ' })).href, internal, 'a blank host');
      assert.equal(trusted(request(internal, { 'x-forwarded-host': ', example.com' })).href, internal, 'a blank first hop');
      assert.equal(trusted(request(internal, { 'x-forwarded-proto': 'ftp' })).href, internal, 'a scheme that is not http(s)');
      assert.equal(trusted(request(internal, { 'x-forwarded-proto': 'HTTPS' })).href, internal, 'and it is compared case-sensitively');
    });

    test('returns a fresh URL each call, so a caller mutating one cannot affect the next', () => {
      const c = request('http://127.0.0.1:3000/', { 'x-forwarded-host': 'example.com' });
      const first = trusted(c);
      first.pathname = '/mutated';
      assert.equal(trusted(c).pathname, '/');
    });
  });
});

describe('resolveServerConfig', () => {
  test('applies the documented defaults', () => {
    const config = resolveServerConfig({}, { isDev: false });
    assert.equal(config.trustProxy, false, 'proxy headers are never trusted by default');
    assert.equal(config.isDev, false, 'the build mode is baked in rather than read from NODE_ENV at runtime');
    assert.equal(config.envBindings, false, 'no platform supplies bindings unless its preset says so');
  });

  // Only `cloudflare` passes it, and `ctx.env` merges `c.env` on exactly that condition. Defaulting the
  // other way would spread an adapter's private handles — a live socket, or a whole Lambda invocation —
  // into an object typed `Record<string, string | undefined>`.
  test('records whether the selected platform supplies bindings', () => {
    assert.equal(resolveServerConfig({}, { isDev: false, envBindings: true }).envBindings, true);
    assert.equal(resolveServerConfig({}, { isDev: false, envBindings: undefined }).envBindings, false);
  });

  test('forces trustProxy on in dev, where the framework owns the proxy', () => {
    const config = resolveServerConfig({ trustProxy: false }, { isDev: true });
    assert.equal(config.trustProxy, true);
    assert.equal(config.isDev, true);
  });
});

// The same parse backs `--port`, `PORT` in the CLI, and `PORT` in the node bundle — one function, so the
// three cannot drift apart. `test/start.test.mjs` covers what the CLI does with the result.
describe('parsePort', () => {
  test('reads a port, including 0 — "any free port"', () => {
    assert.equal(parsePort('3000', 'PORT'), 3000);
    assert.equal(parsePort('0', 'PORT'), 0, 'an explicit 0 is a request, not an accident');
    assert.equal(parsePort('65535', 'PORT'), 65535);
    assert.equal(parsePort(' 8080 ', 'PORT'), 8080, 'a shell heredoc or a .env file leaves whitespace behind');
  });

  test('reads blank as unset rather than as port 0', () => {
    assert.equal(parsePort(undefined, 'PORT'), undefined);
    assert.equal(parsePort('', 'PORT'), undefined, 'an empty PORT is common in CI and container templates');
    assert.equal(parsePort('   ', 'PORT'), undefined);
  });

  test('refuses anything else, naming the source and the value', () => {
    for (const value of ['abc', '-1', '65536', '3.5', '0x50', '1e3', '+80']) {
      assert.throws(
        () => parsePort(value, '--port'),
        (error) => error instanceof RangeError && error.message.includes('--port') && error.message.includes(JSON.stringify(value)),
        `${value} is not a port`,
      );
    }
  });
});

describe('appendVary', () => {
  test('adds to the list instead of replacing it', () => {
    const headers = new Headers();
    appendVary(headers, 'Accept');
    assert.equal(headers.get('vary'), 'Accept');
    appendVary(headers, 'Accept-Encoding');
    assert.equal(headers.get('vary'), 'Accept, Accept-Encoding', 'the earlier entry must survive');
  });

  test('is idempotent and case-insensitive, and leaves * alone', () => {
    const headers = new Headers({ vary: 'accept' });
    appendVary(headers, 'Accept');
    assert.equal(headers.get('vary'), 'accept');

    const wildcard = new Headers({ vary: '*' });
    appendVary(wildcard, 'Accept');
    assert.equal(wildcard.get('vary'), '*', '* already means "never reuse"');
  });
});

describe('varyWith', () => {
  // The pure half, and what the response floor uses: it cannot write through the bag it read the header
  // from, so it needs the answer as a value — and `null` for "nothing to write" is what keeps it from
  // rebuilding a response it had no reason to touch.
  test('answers the header to write, or null when there is nothing to write', () => {
    assert.equal(varyWith(null, 'RSC'), 'RSC', 'no Vary at all: the value is the whole header');
    assert.equal(varyWith('Accept', 'RSC'), 'Accept, RSC', 'what is already there survives');
    assert.equal(varyWith('accept, rsc', 'RSC'), null, 'already listed, case aside');
    assert.equal(varyWith(' * ', 'RSC'), null, '* already means "never reuse"');
  });

  test('answers a list, not a string: a `*` anywhere counts, and an empty header is nothing to append to', () => {
    // Both questions this asks are about the entries. `*` used to have to be the *whole* header to be seen,
    // so a list that already said "never reuse" got another field name added to it for no effect.
    assert.equal(varyWith('Accept-Encoding, *', 'RSC'), null, '* covers every field, wherever it sits in the list');
    assert.equal(varyWith('*, Accept-Encoding', 'RSC'), null);

    // And the one that mattered: an app can set `vary: ''` — building the header from a list that came out
    // empty is the obvious way — and Hono keeps it. Appending to it produced `, RSC`, an empty list element
    // RFC 9110 tells a sender not to generate. A cache strict enough to reject that drops the `Vary`, and a
    // dropped `Vary: RSC` is a flight payload served to a browser asking for the document.
    assert.equal(varyWith('', 'RSC'), 'RSC', 'no entries to keep, so the value is the whole header');
    assert.equal(varyWith('   ', 'RSC'), 'RSC');
    assert.equal(varyWith(' , ', 'RSC'), 'RSC', 'separators without field names are not entries either');

    // What must not change: a header with anything real in it comes back as its author wrote it.
    assert.equal(varyWith('Accept , Accept-Encoding', 'RSC'), 'Accept , Accept-Encoding, RSC', 'spelling and spacing survive');
  });
});

describe('etagMatches', () => {
  const etag = '"abc123"';
  test('matches exact, weak and listed validators', () => {
    assert.equal(etagMatches(etag, etag), true);
    assert.equal(etagMatches(`W/${etag}`, etag), true, 'a proxy that re-encoded the bytes may weaken the tag');
    assert.equal(etagMatches(`"other", ${etag}`, etag), true);
    assert.equal(etagMatches('*', etag), true);
  });

  test('does not match a different or absent validator', () => {
    assert.equal(etagMatches(undefined, etag), false);
    assert.equal(etagMatches('', etag), false);
    assert.equal(etagMatches('"nope"', etag), false);
  });
});

describe('ssgFilePath', () => {
  // The one mapping from a path to the file holding its page — the build's and every deploy target's,
  // because two of them is how a page gets written where no request will ever look for it.
  //
  // Always '/'-separated, on every host: the same string addresses a file (`resolve()` takes forward
  // slashes on Windows) and a key in an asset store, where a backslash is simply the wrong character.
  test('maps a concrete route path to its index.html', () => {
    assert.equal(ssgFilePath('/'), 'index.html');
    assert.equal(ssgFilePath('/docs'), 'docs/index.html');
    assert.equal(ssgFilePath('/docs/getting-started/'), 'docs/getting-started/index.html');
  });

  test('maps the flight variant alongside the document', () => {
    assert.equal(ssgFilePath('/', 'flight'), 'index.rsc');
    assert.equal(ssgFilePath('/docs', 'flight'), 'docs/index.rsc');
  });

  // The blocker this replaced: the build interpolated `staticPaths` values with `encodeURIComponent`,
  // while Hono hands a handler `c.req.path` with `decodeURI` already run over any path holding a `%`.
  // Every non-ASCII slug was therefore built and then never served.
  test('resolves the encoded and the decoded form of a path to the same file', () => {
    for (const [encoded, decoded] of [
      ['/docs/caf%C3%A9', '/docs/café'],
      ['/docs/a%20b', '/docs/a b'],
      ['/%C3%BC', '/ü'],
      ['/docs/%E6%97%A5%E6%9C%AC', '/docs/日本'],
    ]) {
      assert.equal(ssgFilePath(encoded), `${decoded.slice(1)}/index.html`, `${encoded} must resolve decoded`);
      assert.equal(ssgFilePath(decoded), ssgFilePath(encoded), `${decoded} and ${encoded} are one page`);
    }
  });

  test('refuses a segment no portable file name can hold', () => {
    // The first two are route patterns rather than paths; the rest are characters Windows refuses, or a
    // `%2F` that would otherwise smuggle a second segment into one param value.
    for (const path of ['/docs/:slug', '/files/*', '/docs/a%2Fb', '/docs/a%5Cb', '/docs/a?b', '/docs/a|b', '/docs//x']) {
      assert.equal(ssgFilePath(path), null, `${path} must not resolve to a file`);
    }
  });

  // Two Windows rules a macOS or Linux build cannot discover for itself, so they are checked rather than
  // written down as a caveat. The reserved names fail `mkdir` with an `EINVAL` naming a path the author
  // never wrote; the trailing dot and space are worse — Win32 *strips* them, so the page is written where
  // no request will look for it, which is the exact failure this function exists to prevent.
  test('refuses the segment names Windows cannot store', () => {
    for (const path of [
      '/docs/con',
      '/docs/NUL',
      '/docs/com1',
      '/docs/LPT9',
      '/docs/aux',
      '/docs/prn',
      '/docs/con.txt', // an extension does not make it a file name
      '/docs/Con.HTML',
      '/docs/com0',
      '/docs/x.', // trailing dot: stored as `docs/x`
      '/docs/x%20', // trailing space: the same
      '/docs/...', // all dots, so all stripped
    ]) {
      assert.equal(ssgFilePath(path), null, `${path} must not resolve to a file`);
    }
  });

  test('leaves the names that only look reserved alone', () => {
    // The refusal has to be exact: a false one fails a build that was correct, and these are ordinary
    // slugs. `console` starts with `con`, `comic` with `com`, and a dot or space *inside* a name is fine.
    for (const [path, expected] of [
      ['/docs/console', 'docs/console/index.html'],
      ['/docs/contents', 'docs/contents/index.html'],
      ['/docs/comic', 'docs/comic/index.html'],
      ['/docs/nullable', 'docs/nullable/index.html'],
      ['/docs/com', 'docs/com/index.html'],
      ['/docs/v1.2', 'docs/v1.2/index.html'],
      ['/docs/a%20b', 'docs/a b/index.html'],
      ['/docs/.hidden', 'docs/.hidden/index.html'],
    ]) {
      assert.equal(ssgFilePath(path), expected, path);
    }
  });

  // The shared guard every deploy target relies on: an asset store addressed by key has no
  // `resolve()` to fall back on, so a traversal has to be refused here or not at all.
  test('refuses traversal in a request path, escaped or not', () => {
    const attempts = ['/../secret', '/docs/../../etc/passwd', '/..', '/docs/..', '/./docs', '/docs/./x', '/%2e%2e/secret', '/..%2f', '/..%2F'];
    for (const attempt of attempts) {
      assert.equal(ssgFilePath(attempt, 'html'), null, `${attempt} must not resolve to a file`);
    }
  });

  // Not a traversal, and pinned so nobody "fixes" it into one: a double-encoded escape decodes to the
  // literal text `..%2f`, which is one ordinary directory name. The single-encoded forms above are the
  // ones that decode to a separator, and those are refused.
  test('treats a double-encoded escape as the literal name it is', () => {
    assert.equal(ssgFilePath('/..%252f'), '..%2f/index.html');
  });

  // The guard checks *decoded* segments, so what arrives decoded and what does not is load-bearing. Both
  // layers below are upstream, and neither is ours to change — hence a test rather than a comment.
  test('the upstream layers the guard is written against keep their promises', async () => {
    // 1. The URL parser resolves a percent-encoded dot segment when the Request is built, so `%2e%2e`
    //    never reaches a handler as a segment at all.
    for (const encoded of ['%2e%2e', '%2E%2E']) {
      assert.equal(new URL(`/docs/${encoded}/x`, 'http://example.test').pathname, '/x', `${encoded} must be resolved by the URL parser`);
    }

    // 2. Hono hands a handler the path with `decodeURI` run over it, which is the form `ssgFilePath`
    //    stores under — and `decodeURI` leaves the reserved escapes alone, so a `%2F` arrives as an escape
    //    rather than as a separator and cannot smuggle a second segment past the router. The framework's
    //    own per-segment `decodeURIComponent` is what then refuses it as a file name (asserted above).
    const { Hono } = await import('hono');
    const app = new Hono();
    const seen = [];
    app.get('*', (c) => {
      seen.push(c.req.path);
      return c.text('ok');
    });
    for (const path of ['/docs/caf%C3%A9', '/docs/a%2Fb']) await app.fetch(new Request(`http://example.test${path}`));
    assert.deepEqual(seen, ['/docs/café', '/docs/a%2Fb'], 'a non-reserved escape arrives decoded; a %2F arrives as itself');
  });
});

describe('ssgAssetPath', () => {
  // Workers reads the same tree through a URL, so the key has to survive being put into one.
  test('escapes each segment of a store key, and only the segments', () => {
    assert.equal(ssgAssetPath('docs/café/index.html'), 'docs/caf%C3%A9/index.html');
    assert.equal(ssgAssetPath('docs/a b/index.rsc'), 'docs/a%20b/index.rsc');
    assert.equal(ssgAssetPath('docs/a#b/index.html'), 'docs/a%23b/index.html', 'a # would otherwise start a fragment');
  });
});

describe('resolveSiteOrigin', () => {
  test('falls back to a localhost placeholder when unset', () => {
    assert.equal(resolveSiteOrigin(undefined), 'http://localhost');
    assert.equal(resolveSiteOrigin(''), 'http://localhost');
  });

  test('reduces a configured site URL to its origin', () => {
    assert.equal(resolveSiteOrigin('https://example.com'), 'https://example.com');
    assert.equal(resolveSiteOrigin('https://example.com/'), 'https://example.com');
    assert.equal(resolveSiteOrigin('http://localhost:4000'), 'http://localhost:4000');
  });

  test('rejects a base path rather than silently dropping it', () => {
    assert.throws(() => resolveSiteOrigin('https://example.com/docs'), /must be a bare origin/);
    assert.throws(() => resolveSiteOrigin('https://example.com/?a=1'), /must be a bare origin/);
  });

  test('rejects something that is not an http(s) origin', () => {
    for (const bad of ['example.com', 'ftp://example.com', 'not a url']) {
      assert.throws(() => resolveSiteOrigin(bad), /invalid siteUrl/, `${bad} should be rejected`);
    }
  });
});

describe('readPrerendered', () => {
  test('reads a page, derives a stable ETag, and serves the second hit from memory', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'index.html'), '<!DOCTYPE html><p>docs</p>');

    const first = await readPrerendered(dir, '/docs');
    // Bytes, not a string: the entry is served verbatim to every hit, so it is cached already encoded.
    assert.ok(first.body instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(first.body), '<!DOCTYPE html><p>docs</p>');
    assert.equal(first.contentLength, '26');
    assert.match(first.etag, /^W\/"[\w-]{22}"$/, 'weak, so it survives being gzipped on the way out');

    const second = await readPrerendered(dir, '/docs');
    assert.equal(second, first, 'a cache hit returns the very same object, not a re-read');

    // Content decides the ETag, so a different page must not collide with this one.
    writeFileSync(join(dir, 'other.html'), '<!DOCTYPE html><p>other</p>');
    mkdirSync(join(dir, 'other'), { recursive: true });
    writeFileSync(join(dir, 'other', 'index.html'), '<!DOCTYPE html><p>other</p>');
    const other = await readPrerendered(dir, '/other');
    assert.notEqual(other.etag, first.etag);
  });

  // What the build's manifest is for: a `render: 'static'` route the build wrote nothing for — no
  // `staticPaths`, a param it never saw, a page that did not render cleanly — falls through to SSR on every
  // request, and misses are deliberately not cached, so without the index each of those pays a failed read
  // first, forever.
  test('does not touch the store for a path the build did not write', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'listed'), { recursive: true });
    writeFileSync(join(dir, 'listed', 'index.html'), '<!DOCTYPE html><p>listed</p>');
    mkdirSync(join(dir, 'unlisted'), { recursive: true });
    writeFileSync(join(dir, 'unlisted', 'index.html'), '<!DOCTYPE html><p>unlisted</p>');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ files: ['listed/index.html'] }));

    assert.ok(await readPrerendered(dir, '/listed'), 'a page the build recorded is served');
    assert.equal(await readPrerendered(dir, '/unlisted'), null, 'the index is what the store holds — not whatever is on disk');
    assert.equal(await readPrerendered(dir, '/listed', 'flight'), null, 'per variant: the flight half is best-effort and may not exist');
  });

  test('reads the store directly when the build left no manifest', async () => {
    // A build from before there was one. Refusing to serve what it wrote would be worse than the failed
    // read the index exists to avoid.
    const dir = tempDir();
    mkdirSync(join(dir, 'old'), { recursive: true });
    writeFileSync(join(dir, 'old', 'index.html'), '<!DOCTYPE html><p>old</p>');
    assert.ok(await readPrerendered(dir, '/old'));
  });

  test('treats a manifest it cannot parse as no manifest at all', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'page'), { recursive: true });
    writeFileSync(join(dir, 'page', 'index.html'), '<!DOCTYPE html><p>page</p>');
    writeFileSync(join(dir, 'manifest.json'), 'not json');
    assert.ok(await readPrerendered(dir, '/page'), 'a broken index must not take the store down with it');
  });

  test('returns null for a missing page instead of throwing', async () => {
    assert.equal(await readPrerendered(tempDir(), '/nope'), null);
  });

  test('refuses to escape the ssg directory, with the file a traversal would reach actually there', async () => {
    // The version of this test that shipped first ran its attempts against a *freshly created empty* temp
    // dir, so `null` proved nothing beyond "no file was there". Here the file a traversal is aiming at
    // exists and is readable, so the only thing that can refuse it is the guard.
    const parent = tempDir();
    const store = join(parent, 'store');
    mkdirSync(join(parent, 'sibling'), { recursive: true });
    mkdirSync(store, { recursive: true });
    writeFileSync(join(parent, 'sibling', 'index.html'), '<!DOCTYPE html><p>outside the store</p>');
    // The control: the bytes are there, one `..` away from the root, and nothing but the guard is between
    // them and a response.
    assert.match(readFileSync(join(store, '..', 'sibling', 'index.html'), 'utf8'), /outside the store/);

    for (const attempt of ['/../sibling', '/../sibling/', '/docs/../../sibling', '/..%2fsibling', '/%2e%2e/sibling']) {
      assert.equal(await readPrerendered(store, attempt), null, `traversal attempt "${attempt}" must not resolve`);
    }

    // And a page genuinely inside the store still resolves, so the guard is not simply refusing everything.
    mkdirSync(join(store, 'sibling'), { recursive: true });
    writeFileSync(join(store, 'sibling', 'index.html'), '<!DOCTYPE html><p>inside</p>');
    assert.ok(await readPrerendered(store, '/sibling'), 'the same name inside the root is an ordinary page');
  });
});

describe('prerenderStaticRoutes', () => {
  // The server bundle exposes the raw bytes captured by the inline Flight reader on the build's HTML response.
  const okResponse = () => {
    const response = new Response('<!DOCTYPE html><p>ok</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    setPrerenderFlight(response, Promise.resolve(new TextEncoder().encode('0:{"root":"flight"}')));
    return response;
  };

  test('writes both representations per static route and per staticPaths entry', async () => {
    const ssgDir = tempDir();
    const requested = [];
    const result = await prerenderStaticRoutes({
      ssgDir,
      routes: [
        { path: '/about', render: 'static', component: async () => ({ default: () => null }) },
        {
          path: '/docs/:slug',
          render: 'static',
          component: async () => ({ default: () => null }),
          staticPaths: async () => [{ slug: 'a' }, { slug: 'b' }],
        },
        { path: '/live', component: async () => ({ default: () => null }) },
      ],
      fetch: (request) => {
        requested.push(`${request.headers.get('RSC') ? 'flight' : 'document'} ${new URL(request.url).pathname}`);
        return okResponse(request);
      },
    });

    assert.deepEqual(result.written, ['/about', '/docs/a', '/docs/b'], 'reported in route order, whatever order they rendered in');
    assert.deepEqual(
      requested.toSorted(),
      ['document /about', 'document /docs/a', 'document /docs/b'],
      'each static path is rendered once; the dynamic route is never prerendered',
    );
    const decode = (page) => new TextDecoder().decode(page.body);
    assert.equal(decode(await readPrerendered(ssgDir, '/docs/a')), '<!DOCTYPE html><p>ok</p>');
    assert.equal(decode(await readPrerendered(ssgDir, '/docs/a', 'flight')), '0:{"root":"flight"}');

    // The index the reader gates on: every file, under the name a *request* resolves to, and nothing for
    // the dynamic route that was never prerendered.
    const manifest = JSON.parse(readFileSync(join(ssgDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.toSorted(), [
      'about/index.html',
      'about/index.rsc',
      'docs/a/index.html',
      'docs/a/index.rsc',
      'docs/b/index.html',
      'docs/b/index.rsc',
    ]);
  });

  test('writes a payload carrying binary rows byte-for-byte', async () => {
    // A flight payload is not text: `emitChunk` puts the raw bytes of a `Uint8Array` a server component
    // returned straight on the wire. Reading a variant with `response.text()` is a *non-fatal* UTF-8 decode,
    // so each of those bytes became U+FFFD and was written back out as three — a page the build reports as
    // prerendered and the client cannot parse, on every soft navigation to it, forever.
    const payload = Buffer.from('303a226869220a313afffe0a', 'hex');
    const ssgDir = tempDir();
    await prerenderStaticRoutes({
      ssgDir,
      routes: [{ path: '/about', render: 'static', component: async () => ({ default: () => null }) }],
      fetch: () => {
        const response = new Response('<!DOCTYPE html><p>ok</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
        setPrerenderFlight(response, Promise.resolve(payload));
        return response;
      },
    });

    const stored = await readPrerendered(ssgDir, '/about', 'flight');
    assert.deepEqual(Buffer.from(stored.body), payload, 'the file on disk must be the bytes the render produced');
  });

  test('renders a path once however many times staticPaths returns it', async () => {
    const requested = [];
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    let result;
    try {
      result = await prerenderStaticRoutes({
        ssgDir: tempDir(),
        routes: [
          {
            path: '/docs/:slug',
            render: 'static',
            component: async () => ({ default: () => null }),
            staticPaths: async () => [{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }],
          },
        ],
        fetch: (request) => {
          requested.push(new URL(request.url).pathname);
          return okResponse(request);
        },
      });
    } finally {
      console.warn = warn;
    }

    assert.deepEqual(result.written, ['/docs/a', '/docs/b']);
    assert.equal(requested.filter((path) => path === '/docs/a').length, 1, 'one shared render, not one render per output format');
    assert.match(warnings.join('\n'), /repeated 1 path/, 'and the app is told, since a repeated entry is usually a bug in its query');
  });

  test('renders paths concurrently, up to a bound', async () => {
    let inFlight = 0;
    let peak = 0;
    const slugs = Array.from({ length: 20 }, (_, index) => `p${index}`);
    const result = await prerenderStaticRoutes({
      ssgDir: tempDir(),
      routes: [
        {
          path: '/docs/:slug',
          render: 'static',
          component: async () => ({ default: () => null }),
          staticPaths: async () => slugs.map((slug) => ({ slug })),
        },
      ],
      fetch: async (request) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return okResponse(request);
      },
    });

    assert.deepEqual(
      result.written,
      slugs.map((slug) => `/docs/${slug}`),
      'reported in staticPaths order, whatever order they finished in',
    );
    assert.ok(peak > 1, "rendered one at a time, a few hundred paths pay every page's latency in series");
    assert.ok(peak <= 8, `and rendered all at once, a build points the whole site at the app's database (peak ${peak})`);
  });

  test('renders against siteUrl, so absolute URLs in the output are the deployed ones', async () => {
    const seen = [];
    await prerenderStaticRoutes({
      ssgDir: tempDir(),
      siteUrl: 'https://example.com',
      routes: [{ path: '/about', render: 'static', component: async () => ({ default: () => null }) }],
      fetch: (request) => {
        seen.push(request.url);
        return okResponse(request);
      },
    });
    assert.deepEqual(seen, ['https://example.com/about']);
  });

  test('keeps the document when the shared Flight payload cannot be captured', async () => {
    const ssgDir = tempDir();
    const result = await prerenderStaticRoutes({
      ssgDir,
      routes: [{ path: '/about', render: 'static', component: async () => ({ default: () => null }) }],
      // No bridge property represents a renderer that could not provide its second stream branch. The SSG
      // pass must keep the valid document and let a later soft navigation render Flight per request.
      fetch: () => new Response('<!DOCTYPE html><p>ok</p>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    });

    assert.deepEqual(result.written, ['/about'], 'a missing flight payload must not lose the document');
    assert.ok(await readPrerendered(ssgDir, '/about'));
    assert.equal(await readPrerendered(ssgDir, '/about', 'flight'), null, 'serving falls back to rendering it per request');
  });

  test('keeps the document when the shared Flight branch rejects', async () => {
    const ssgDir = tempDir();
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      await prerenderStaticRoutes({
        ssgDir,
        routes: [{ path: '/about', render: 'static', component: async () => ({ default: () => null }) }],
        fetch: () => {
          const response = new Response('<!DOCTYPE html><p>ok</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
          setPrerenderFlight(
            response,
            Promise.resolve().then(() => {
              throw new Error('flight branch failed');
            }),
          );
          return response;
        },
      });
    } finally {
      console.warn = warn;
    }

    assert.ok(await readPrerendered(ssgDir, '/about'), 'the valid document remains available');
    assert.equal(await readPrerendered(ssgDir, '/about', 'flight'), null, 'only Flight falls back to a request-time render');
    assert.match(warnings.join('\n'), /shared Flight capture failed: flight branch failed/);
  });

  test('skips a parameterised static route with no staticPaths rather than failing the build', async () => {
    const result = await prerenderStaticRoutes({
      ssgDir: tempDir(),
      routes: [{ path: '/docs/:slug', render: 'static', component: async () => ({ default: () => null }) }],
      fetch: okResponse,
    });
    assert.deepEqual(result.written, []);
    assert.deepEqual(result.skipped, ['/docs/:slug']);
  });

  // A 5xx means the app threw, and this pass renders a page exactly as a request does — so the route will
  // throw again per request, forever. It used to be warned about as "will SSR per request" and skipped,
  // which is true of every *other* skip reason and false of this one; the build then exited 0.
  test('fails the build for a page that rendered 5xx, rather than calling it a skip', async () => {
    await assert.rejects(
      prerenderStaticRoutes({
        ssgDir: tempDir(),
        routes: [{ path: '/boom', render: 'static', component: async () => ({ default: () => null }) }],
        fetch: () => new Response('nope', { status: 500 }),
      }),
      (error) => {
        assert.match(error.message, /\[rsvhono\] 1 page failed to render while prerendering/);
        assert.match(error.message, /"\/boom" rendered 500/);
        assert.doesNotMatch(error.message, /will SSR per request/, 'because it will not — it will 500 per request');
        return true;
      },
    );
  });

  // The other side of the split: a page the pass cannot store but the server can still render is skipped,
  // which is what the warning has always said. `notFound()` from a static page is the ordinary case.
  test('still skips a page that answered something unprerenderable but servable', async () => {
    for (const status of [404, 302]) {
      const warnings = [];
      const warn = console.warn;
      console.warn = (message) => warnings.push(String(message));
      let result;
      try {
        result = await prerenderStaticRoutes({
          ssgDir: tempDir(),
          routes: [{ path: '/gone', render: 'static', component: async () => ({ default: () => null }) }],
          fetch: () => new Response('gone', { status }),
        });
      } finally {
        console.warn = warn;
      }
      assert.deepEqual(result.written, [], `${status} must not be stored`);
      assert.deepEqual(result.skipped, ['/gone'], `${status} must be skipped, not fatal`);
      assert.match(warnings.join('\n'), /will SSR per request/);
    }
  });

  test('names every failing page at once, in route order', async () => {
    await assert.rejects(
      prerenderStaticRoutes({
        ssgDir: tempDir(),
        routes: ['/a', '/b'].map((path) => ({ path, render: 'static', component: async () => ({ default: () => null }) })),
        fetch: () => new Response('nope', { status: 500 }),
      }),
      (error) => {
        assert.match(error.message, /2 pages failed to render/);
        assert.ok(error.message.indexOf('"/a"') < error.message.indexOf('"/b"'), 'reported in route order, not completion order');
        return true;
      },
    );
  });

  // A route whose paths cannot be computed is unprerenderable, not unservable — the same answer as a
  // parameterised route with no `staticPaths` at all, one branch above it in the source. These used to
  // throw out of the pass and take the whole build with them, for routes that work perfectly per request.
  test('warns and skips a param shape it cannot turn into a single file, rather than failing the build', async () => {
    const cases = [
      { path: '/files/*', staticPaths: async () => [{}], expected: /wildcard segments/ },
      { path: '/docs/:slug{[a-z]+}', staticPaths: async () => [{ slug: 'a' }], expected: /optional\/regex params/ },
      { path: '/docs/:slug', staticPaths: async () => [{ wrong: 'a' }], expected: /without "slug"/ },
      { path: '/docs/:slug', staticPaths: () => Promise.reject(new Error('the database is down')), expected: /database is down/ },
    ];
    for (const { path, staticPaths, expected } of cases) {
      const warnings = [];
      const warn = console.warn;
      console.warn = (message) => warnings.push(String(message));
      let result;
      try {
        result = await prerenderStaticRoutes({
          ssgDir: tempDir(),
          routes: [
            { path, render: 'static', staticPaths, component: async () => ({ default: () => null }) },
            { path: '/about', render: 'static', component: async () => ({ default: () => null }) },
          ],
          fetch: okResponse,
        });
      } finally {
        console.warn = warn;
      }

      assert.deepEqual(result.skipped, [path], `"${path}" should be skipped`);
      assert.deepEqual(result.written, ['/about'], 'and the routes around it still prerender');
      assert.match(warnings.join('\n'), expected, `"${path}" should say why`);
      assert.match(warnings.join('\n'), /will SSR per request/i, 'and what happens instead');
    }
  });

  // The round trip, not `interpolatePath` in isolation — testing the halves separately is exactly what let
  // a page be built under a name no request ever resolves to.
  test('a param value needing percent-encoding is served back for the path the browser asks for', async () => {
    const ssgDir = tempDir();
    const requested = [];
    const result = await prerenderStaticRoutes({
      ssgDir,
      routes: [
        {
          path: '/docs/:slug',
          render: 'static',
          component: async () => ({ default: () => null }),
          staticPaths: async () => [{ slug: 'café' }, { slug: 'a b' }],
        },
      ],
      fetch: (request) => {
        requested.push(new URL(request.url).pathname);
        return okResponse(request);
      },
    });

    assert.deepEqual(result.written, ['/docs/caf%C3%A9', '/docs/a%20b']);
    assert.deepEqual(
      requested.toSorted(),
      ['/docs/a%20b', '/docs/caf%C3%A9'],
      'the page is fetched once at the URL a browser would use, with both representations derived from it',
    );

    // …and read back at `c.req.path`, which is what Hono hands the handler: `decodeURI` has already run.
    for (const requestPath of ['/docs/café', '/docs/a b']) {
      assert.ok(await readPrerendered(ssgDir, requestPath), `${requestPath} must be served from the build`);
      assert.ok(await readPrerendered(ssgDir, requestPath, 'flight'), `${requestPath} must soft-navigate from the build`);
    }
  });

  // A page under a nonce-based CSP is prerendered in half: the flight payload is served from disk, the
  // document is re-rendered per request because it has to carry a fresh nonce. The build used to report all
  // three testbed pages as "prerendered" while the deployment read the documents of none of them.
  test('reports a page whose document a CSP nonce will re-render as flight-only, and says so once', async () => {
    const ssgDir = tempDir();
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    let result;
    try {
      result = await prerenderStaticRoutes({
        ssgDir,
        routes: [
          { path: '/nonced', render: 'static', component: async () => ({ default: () => null }) },
          { path: '/plain', render: 'static', component: async () => ({ default: () => null }) },
        ],
        // The framework marks the document it rendered when the app minted a nonce for that path — what
        // `secureHeaders({ …NONCE })` does on every request, and so at build time too.
        fetch: (request) => {
          const response = okResponse(request);
          if (new URL(request.url).pathname === '/nonced' && request.headers.get('RSC') !== '1') {
            response.headers.set(PRERENDER_NONCE_HEADER, '1');
          }
          return response;
        },
      });
    } finally {
      console.warn = warn;
    }

    assert.deepEqual(result.written, ['/nonced', '/plain'], 'both pages are still prerendered — the flight payload is served');
    assert.deepEqual(result.flightOnly, ['/nonced'], 'only the page under the nonce is half-served');
    assert.match(warnings.join('\n'), /1 page\(s\) mint a CSP nonce/, 'and the build says so');
    assert.equal(warnings.filter((line) => line.includes('mint a CSP nonce')).length, 1, 'once, not per page');

    // Written all the same: the policy may be off where this is deployed, and then the document is served.
    assert.ok(await readPrerendered(ssgDir, '/nonced'), 'the document is still on disk');
    assert.ok(await readPrerendered(ssgDir, '/nonced', 'flight'), 'and so is the payload that will be read');
  });

  test('fails the build for a value it cannot store as one file, rather than writing a page nothing serves', async () => {
    // `con` and `x.` are the two Windows rules: the first fails `mkdir` there with an error naming a path
    // nobody wrote, the second is stored under the trimmed name, so the page lands where no request looks.
    for (const slug of ['a b/c', 'a:b', '..', 'con', 'NUL', 'x.', 'x ']) {
      await assert.rejects(
        prerenderStaticRoutes({
          ssgDir: tempDir(),
          routes: [
            {
              path: '/docs/:slug',
              render: 'static',
              component: async () => ({ default: () => null }),
              staticPaths: async () => [{ slug }],
            },
          ],
          fetch: okResponse,
        }),
        /Cannot prerender .* for route "\/docs\/:slug"/,
        `"${slug}" should be rejected`,
      );
    }
  });
});

describe('control signals', () => {
  test('a redirect round-trips through its digest', () => {
    const signal = new RedirectSignal('/dashboard?next=/a b', 303);
    assert.equal(isControlDigest(signal.digest), true);
    assert.deepEqual(parseRedirectDigest(signal.digest), { location: '/dashboard?next=/a b', status: 303 });
  });

  test('a notFound digest is a control signal but not a redirect', () => {
    assert.equal(isControlDigest('RSVHONO_NOT_FOUND'), true);
    assert.equal(parseRedirectDigest('RSVHONO_NOT_FOUND'), null);
  });

  test('a digest tagged with its render parses to the same intent, and gives the token back', () => {
    // The location has a `#` of its own, which is what the token is split off at: it is percent-encoded
    // inside the digest, so the split cannot land in it.
    const redirect = new RedirectSignal('/docs#install', 307);
    const tagged = controlDigestFor(redirect, 'render-1');
    assert.equal(isControlDigest(tagged), true);
    assert.deepEqual(parseRedirectDigest(tagged), { location: '/docs#install', status: 307 });
    assert.deepEqual(parseControlIntent({ digest: tagged }), {
      intent: { kind: 'redirect', location: '/docs#install', status: 307 },
      renderToken: 'render-1',
    });

    const missing = controlDigestFor(new NotFoundSignal(), 'render-2');
    assert.equal(isControlDigest(missing), true);
    assert.deepEqual(parseControlIntent({ digest: missing }), { intent: { kind: 'not-found' }, renderToken: 'render-2' });
  });

  test('a digest with no token parses with none, and anything else is not an intent', () => {
    // A prerendered payload's, and what `controlDigestFor` writes when it is given no token.
    const redirect = new RedirectSignal('/a', 303);
    assert.equal(controlDigestFor(redirect, undefined), redirect.digest);
    assert.deepEqual(parseControlIntent(redirect), { intent: { kind: 'redirect', location: '/a', status: 303 }, renderToken: undefined });
    for (const error of [undefined, null, new Error('boom'), { digest: 'some-react-digest' }, { digest: 'RSVHONO_NOT_FOUND_AT_ALL' }]) {
      assert.equal(parseControlIntent(error), undefined);
    }
  });

  test('an unrelated digest is left alone', () => {
    for (const digest of [undefined, null, 42, '', 'some-react-digest']) {
      assert.equal(isControlDigest(digest), false, `${String(digest)} must not read as a control signal`);
    }
  });

  test('a malformed escape is read as literal text rather than thrown', () => {
    // The digest crosses a payload boundary and `parseRedirectDigest` runs on the client from React's error
    // callbacks and from a rejected fetch, where a throw escapes as an unhandled rejection or out of the
    // callback. `RedirectSignal` percent-encodes every target, so a malformed escape is corruption rather
    // than a target — and the literal text is the better guess, the same fallback `jumpToAnchor` makes. It
    // stays a redirect either way: answering `null` would make it read as a `notFound()`.
    const corrupt = 'RSVHONO_REDIRECT;307;%E0%A4%A';
    assert.equal(isControlDigest(corrupt), true);
    assert.deepEqual(parseRedirectDigest(corrupt), { location: '%E0%A4%A', status: 307 });
  });
});

describe('RequestContext enumerability', () => {
  // React's diagnostic for a value that cannot cross to a client component walks `Object.keys`
  // recursively with no depth limit and no cycle guard. The Hono context reaches the socket and the
  // whole server through `req.raw` / `env`, so while `raw` was an own enumerable property, passing a
  // RequestContext to a `'use client'` component overflowed the stack *inside React's error-message builder* —
  // and its real "Only plain objects … can be passed to Client Components" error never printed.
  const fakeHonoContext = { req: { url: 'http://example.test/', param: () => ({}) }, env: {} };
  // The cycle that made the walk unbounded, so this test fails the same way React did if `raw` ever
  // becomes enumerable again.
  fakeHonoContext.self = fakeHonoContext;

  test('the Hono context is reachable but not enumerable, so a serializer cannot walk into it', () => {
    const ctx = new RequestContext(fakeHonoContext);
    assert.equal(ctx.hono, fakeHonoContext, 'ctx.hono is documented public API and must keep working');
    assert.ok(!Object.keys(ctx).includes('hono'), 'ctx.hono must not be an own enumerable property');
    // `req` is the same hazard by a shorter path — it *is* the object holding the cycle.
    assert.ok(!Object.keys(ctx).includes('req'), 'ctx.req must not be an own enumerable property either');
    assert.doesNotThrow(() => JSON.stringify(ctx), 'walking a RequestContext must not reach the cyclic Hono context');
  });

  test('the wrapper still resolves request data through the hidden context', () => {
    const ctx = new RequestContext(fakeHonoContext);
    assert.equal(ctx.url.pathname, '/');
    assert.equal(ctx.req.url, 'http://example.test/', 'ctx.req is the promoted Hono request');
    assert.deepEqual(ctx.params, {}, 'ctx.params falls back to an empty record with no route match');
    assert.equal(ctx.hono.req.url, 'http://example.test/', 'the escape hatch still reaches the same request');
  });

  // Hono's response builders are silent no-ops from inside a page, which is the confusion the stubs
  // exist to end. Each must throw and name the API that does work.
  test("Hono's response builders throw instead of doing nothing", () => {
    const ctx = new RequestContext(fakeHonoContext);
    assert.throws(() => ctx.redirect(), /Use `redirect\(\)` from '@rsvhono\/core\/server'/);
    assert.throws(() => ctx.notFound(), /Use `notFound\(\)` from '@rsvhono\/core\/server'/);
    assert.throws(() => ctx.header(), /Use `ctx\.setHeader\(name, value\)`/);
    for (const call of ['json', 'text', 'html', 'body', 'status']) {
      assert.throws(() => ctx[call](), /\[rsvhono\]/, `ctx.${call}() must throw rather than silently do nothing`);
    }
  });

  test('response writes are allowed before the render and throw once it has begun', () => {
    const headers = [];
    const c = { ...fakeHonoContext, header: (name, value) => headers.push([name, value]) };
    const ctx = new RequestContext(c);

    // An action's context: the render has not started, so the write reaches the response.
    ctx.setHeader('x-before', '1');
    assert.deepEqual(headers, [['x-before', '1']]);

    beginPageRender(c);
    assert.throws(() => ctx.setHeader('x-after', '1'), /too late to affect the response/);
    assert.throws(() => ctx.cookies.set('a', 'b'), /too late to affect the response/);
    assert.throws(() => ctx.cookies.delete('a'), /too late to affect the response/);
    assert.deepEqual(headers, [['x-before', '1']], 'nothing may be written after the render begins');
  });

  test('reads stay available throughout the render', () => {
    const c = { ...fakeHonoContext, req: { ...fakeHonoContext.req, header: () => 'v' } };
    const ctx = new RequestContext(c);
    beginPageRender(c);
    assert.equal(ctx.url.pathname, '/', 'ctx.url must survive the render marker');
    assert.equal(ctx.req.header('x'), 'v', 'ctx.req must survive the render marker');
    assert.deepEqual(ctx.params, {});
  });
});

describe('scanPageFiles', () => {
  test('resolves inline component thunks, including @/ and index files', () => {
    const dir = tempDir();
    const srcDir = join(dir, 'src');
    mkdirSync(join(srcDir, 'components', 'nested'), { recursive: true });
    writeFileSync(join(srcDir, 'components', 'home.tsx'), 'export default () => null;');
    writeFileSync(join(srcDir, 'components', 'about.ts'), 'export default () => null;');
    writeFileSync(join(srcDir, 'components', 'nested', 'index.tsx'), 'export default () => null;');

    const routesFile = join(srcDir, 'routes.ts');
    writeFileSync(
      routesFile,
      `export const routes = [
         { path: '/', component: () => import('./components/home') },
         { path: '/about', component: async () => import("@/components/about") },
         { path: '/nested', component: () => import('./components/nested') },
         { path: '/missing', component: () => import('./components/gone') },
         { path: '/indirect', component: loadSomething },
       ];`,
    );

    const found = new Set();
    scanPageFiles(routesFile, srcDir, found);
    assert.deepEqual(
      [...found].sort(),
      [join(srcDir, 'components', 'about.ts'), join(srcDir, 'components', 'home.tsx'), join(srcDir, 'components', 'nested', 'index.tsx')].sort(),
      'unresolvable and non-inline thunks are simply not page files',
    );
  });

  test('clears previous results so a removed route stops being a page file', () => {
    const dir = tempDir();
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    const routesFile = join(srcDir, 'routes.ts');
    writeFileSync(routesFile, `export const routes = [];`);

    const found = new Set(['stale-entry']);
    scanPageFiles(routesFile, srcDir, found);
    assert.deepEqual([...found], []);
  });

  test('an unreadable routes file leaves the set empty instead of throwing', () => {
    const found = new Set();
    scanPageFiles(join(tempDir(), 'does-not-exist.ts'), tempDir(), found);
    assert.deepEqual([...found], []);
  });
});

describe('deploy target resolution', () => {
  test('defaults to node, and a blank source is no source at all', () => {
    assert.equal(resolveDeployPreset().name, 'node');
    assert.equal(resolveDeployPreset({}).name, 'node');
    // An `RSVHONO_DEPLOY=` that a CI environment sets but never fills in has to fall through to the
    // config file rather than fail the build on the empty string.
    assert.equal(resolveDeployPreset({ env: '' }).name, 'node');
    assert.equal(resolveDeployPreset({ env: '   ' }).name, 'node');
  });

  test('the flag wins over the environment, which wins over the config file', () => {
    assert.equal(resolveDeployPreset({ flag: 'node', env: 'cloudflare', config: 'cloudflare' }).name, 'node');
    assert.equal(resolveDeployPreset({ env: 'cloudflare', config: 'node' }).name, 'cloudflare');
    assert.equal(resolveDeployPreset({ config: 'cloudflare' }).name, 'cloudflare');
    // A loser never reaches the lookup, so only the winner can be the one reported as unknown.
    assert.throws(() => resolveDeployPreset({ flag: 'from-flag', env: 'node', config: 'node' }), /from-flag/);
  });

  test('every target resolves to a preset that can name its own runtime and deploy command', () => {
    for (const target of DEPLOY_TARGETS) {
      const preset = resolveDeployPreset({ config: target });
      assert.equal(preset.name, target);
      assert.match(preset.runtimeModule, /^deploy\/[\w-]+\/runtime\.js$/, `${target} points at a runtime module`);
      assert.equal(deployHintFor(target), preset.deployHint);
      assert.ok(preset.deployHint.length > 0, `${target} says how to deploy`);
    }
  });

  test('an unknown target fails the build, naming the ones that exist', () => {
    assert.throws(() => resolveDeployPreset({ config: 'fly' }), /unknown deploy target "fly"/);
    assert.throws(() => resolveDeployPreset({ config: 'fly' }), new RegExp(DEPLOY_TARGETS.join(', ')));
    assert.equal(deployHintFor('fly'), null, 'a dist/ from a newer rsvhono can carry a name this one lacks');
  });

  // A bare bracket access resolves every `Object.prototype` key to an inherited value, which then passes a
  // truthiness guard: `RSVHONO_DEPLOY=constructor` used to reach the builder and die there on
  // `preset.runtimeModule.split('/')` instead of being named as the typo it is.
  test('a prototype key is a typo, not a target', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.throws(() => resolveDeployPreset({ env: key }), /unknown deploy target/, `${key} must not resolve to a preset`);
      assert.equal(deployHintFor(key), null, `${key} has no deploy hint`);
    }
  });
});

describe('publicRouteCollisions', () => {
  // `mountPublicFallback` puts `public/` after every route, so it answers only what no route claimed — the
  // whole story on `node` and `aws-lambda`, and not on the two targets with a CDN in front, where `public/`
  // is part of the static output and the platform answers from it *before* the app runs. The framework
  // cannot reorder either one, so the build says so; this is the comparison it says it from.
  const page = (path) => ({ path, component: async () => ({ default: () => null }) });

  /** A `public/` tree on disk, since the check reads one. */
  function publicTree(files) {
    const dir = mkdtempSync(join(tmpdir(), 'rsvhono-public-'));
    for (const file of files) {
      mkdirSync(join(dir, dirname(file)), { recursive: true });
      writeFileSync(join(dir, file), 'x');
    }
    return dir;
  }

  const collisionsFor = (files, routes, htmlExtensionless = false) => publicRouteCollisions(publicTree(files), routes, { htmlExtensionless });

  test('finds a file on a route’s own path', () => {
    const found = collisionsFor(['about.html'], [page('/'), page('/about.html')]);
    assert.equal(found.length, 1);
    assert.match(found[0], /public\/about\.html answers \/about\.html, which a page route claims/);
  });

  test('resolves an index.html to the directory it answers, not to its filename', () => {
    // The collision on the one path every app has. Keyed on filenames alone this would be invisible:
    // nothing has a route at `/index.html`.
    assert.match(collisionsFor(['index.html'], [page('/')])[0], /answers \//);
    assert.match(collisionsFor(['docs/index.html'], [page('/docs')])[0], /answers \/docs/);
    assert.match(collisionsFor(['docs/index.html'], [page('/docs/')])[0], /answers \/docs\//, 'with and without the trailing slash');
  });

  test('drops the .html only where the platform’s own handling does', () => {
    // Cloudflare's Workers Assets defaults to `auto-trailing-slash`, so `about.html` answers `/about`
    // there. Vercel serves it at `/about.html` and adds `/about` only with `cleanUrls`, which is the
    // project's setting — warning about it anyway would be a warning about a collision the platform
    // does not have, and a check that cries wolf is one every app learns to ignore.
    assert.equal(collisionsFor(['about.html'], [page('/about')], true).length, 1, 'cloudflare');
    assert.deepEqual(collisionsFor(['about.html'], [page('/about')], false), [], 'vercel');
  });

  test('says nothing when nothing collides', () => {
    assert.deepEqual(publicRouteCollisions(null, [page('/')], { htmlExtensionless: true }), [], 'an app with no public/');
    assert.deepEqual(collisionsFor(['robots.txt', 'favicon.svg', 'img/logo.png'], [page('/'), page('/about')], true), []);
    // A parameterised route is not compared: matching one needs the router rather than a set, and the
    // failure mode of guessing is a warning about a build that was fine.
    assert.deepEqual(collisionsFor(['docs/x.html'], [page('/docs/:slug'), page('/files/*')], true), []);
  });

  test('names the kind of route, since an endpoint and a page are fixed differently', () => {
    const endpoint = { type: 'endpoint', path: '/api/health', server: async () => ({ handler: () => null }) };
    assert.match(collisionsFor(['api/health'], [endpoint])[0], /which an endpoint route claims/);
  });
});

describe('the generated Vite config', () => {
  const options = { rootDir: MINIMAL_APP_DIR, isDev: false, preset: NODE_PRESET };

  test('lays the three environments out where every platform expects them', () => {
    const config = createViteConfig({ ...options, config: {} });
    assert.equal(config.base, '/_static/');
    assert.match(config.environments.rsc.build.outDir, /^dist[\\/]server$/);
    assert.match(config.environments.ssr.build.outDir, /^dist[\\/]server[\\/]ssr$/);
    assert.match(config.environments.client.build.outDir, /^dist[\\/]static$/);
  });

  test("the app's vite option is merged over it, and cannot move what the framework owns", () => {
    const appPlugin = { name: 'app-plugin' };
    const config = createViteConfig({
      ...options,
      config: { vite: { base: '/elsewhere/', root: '/nowhere', define: { __APP__: '1' }, plugins: [appPlugin] } },
    });
    assert.equal(config.define.__APP__, '1', 'app settings are kept');
    assert.ok('__RSVHONO_CONFIG__' in config.define, 'next to the generated ones');
    assert.equal(config.base, '/_static/');
    assert.equal(config.root, MINIMAL_APP_DIR);
    const names = config.plugins.flat(Infinity).map((plugin) => plugin?.name);
    assert.ok(names.indexOf('app-plugin') < names.indexOf('rsvhono:pages'), "the app's plugins run ahead of the framework's");
  });

  test('a serverless target bundles its dependencies; node leaves them in node_modules', () => {
    const node = createViteConfig({ ...options, config: {} });
    assert.deepEqual(node.environments.rsc.resolve.noExternal, ['@rsvhono/core']);
    const lambda = createViteConfig({ ...options, config: {}, preset: resolveDeployPreset({ flag: 'aws-lambda' }) });
    assert.equal(lambda.environments.rsc.resolve.noExternal, true);
    assert.equal(lambda.environments.ssr.resolve.noExternal, true);
  });

  test('the client environment is compiled against the public environment only', () => {
    process.env.PUBLIC_UNIT_PROBE = 'visible';
    process.env.UNIT_PROBE_SECRET = 'hidden';
    try {
      const config = createViteConfig({ ...options, config: {} });
      const env = JSON.parse(config.environments.client.define['process.env']);
      assert.equal(env.PUBLIC_UNIT_PROBE, 'visible');
      assert.equal('UNIT_PROBE_SECRET' in env, false);
      assert.equal(env.NODE_ENV, 'production');
      assert.equal('process.env' in (config.environments.rsc.define ?? {}), false, 'server code reads the real process.env');
    } finally {
      delete process.env.PUBLIC_UNIT_PROBE;
      delete process.env.UNIT_PROBE_SECRET;
    }
  });
});

describe('createPageCache', () => {
  const pageOf = (size) => ({ body: new Uint8Array(size), contentLength: String(size), etag: `W/"${size}"` });

  test('evicts oldest-first to stay inside its byte budget', () => {
    const cache = createPageCache(300);
    cache.set('a', pageOf(100));
    cache.set('b', pageOf(100));
    cache.set('c', pageOf(100));
    assert.ok(cache.get('a'), 'still inside the budget');

    cache.set('d', pageOf(100));
    assert.equal(cache.get('a'), undefined, 'the oldest went');
    assert.ok(cache.get('b') && cache.get('c') && cache.get('d'));
  });

  test('counts bytes rather than entries', () => {
    const cache = createPageCache(300);
    cache.set('big', pageOf(250));
    cache.set('small', pageOf(100));
    assert.equal(cache.get('big'), undefined, 'two entries, but 350 bytes');
    assert.ok(cache.get('small'));
  });

  test('serves a page too big to store rather than emptying the cache for it', () => {
    const cache = createPageCache(300);
    cache.set('keep', pageOf(100));
    cache.set('huge', pageOf(500));
    assert.equal(cache.get('huge'), undefined, 'not stored');
    assert.ok(cache.get('keep'), 'and nothing was evicted to make room for it');
  });

  test('re-setting a key does not double-count its bytes', () => {
    const cache = createPageCache(300);
    cache.set('a', pageOf(200));
    cache.set('a', pageOf(200));
    cache.set('b', pageOf(100));
    assert.ok(cache.get('a') && cache.get('b'), '300 bytes held, not 500');
  });

  test('re-setting a key moves it to the back, so the write is never what its own eviction drops', () => {
    // `Map.set` on an existing key keeps that key's original position. Without a delete first, growing the
    // oldest entry would overflow the budget and then evict that same entry — the cache dropping the page it
    // was just asked to store while keeping newer, smaller ones.
    const cache = createPageCache(100);
    cache.set('old', pageOf(10));
    cache.set('new', pageOf(80));
    cache.set('old', pageOf(90));
    assert.ok(cache.get('old'), 'the page just stored must survive its own eviction pass');
    assert.equal(cache.get('new'), undefined, 'the genuinely older entry is what goes');
  });
});

describe('checkReactVersions', () => {
  /** An app root with whatever versions of the two packages the case needs installed into it. */
  const appWith = (versions) => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', private: true }));
    for (const [name, version] of Object.entries(versions)) {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true });
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
    return dir;
  };

  /** The RSC runtime the framework itself carries: what an app's React has to match. */
  const RUNTIME = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'node_modules', 'react-server-dom-webpack', 'package.json'), 'utf8'),
  ).version;

  test('refuses a react/react-dom split, naming every version', () => {
    const dir = appWith({ react: RUNTIME, 'react-dom': '19.1.0' });
    assert.throws(
      () => checkReactVersions(dir),
      new RegExp(`react ${RUNTIME}, react-dom 19\\.1\\.0 and react-server-dom-webpack ${RUNTIME} resolve to different versions`),
    );
    // The advice has to name the escape hatch, since a transitive dependency is the usual cause.
    assert.throws(() => checkReactVersions(dir), /overrides/);
  });

  test('refuses a matching pair that is not the RSC runtime’s version', () => {
    // The pair agreeing is not enough: the runtime compiled into the server bundle is a third build.
    assert.throws(() => checkReactVersions(appWith({ react: '19.2.8', 'react-dom': '19.2.8' })), new RegExp(`exactly ${RUNTIME}`));
  });

  test('accepts all three at one version', () => {
    checkReactVersions(appWith({ react: RUNTIME, 'react-dom': RUNTIME }));
  });

  test('says nothing when neither is installed — the resolver reports that better', () => {
    checkReactVersions(appWith({}));
  });

  test('does not fire on a real app', () => {
    // The check runs on every dev and build, so a false positive here would break every one of them.
    checkReactVersions(MINIMAL_APP_DIR);
  });
});

describe('parseRenderRequest', () => {
  const BASE = 'https://app.test/page';
  const parse = (init) => parseRenderRequest(new Request(BASE, init));

  test('classifies a GET by the RSC header alone', () => {
    assert.deepEqual(parse({}), { kind: 'document' });
    assert.deepEqual(parse({ headers: { RSC: '1' } }), { kind: 'rsc' });
    // Exactly two states — that is what makes `Vary: RSC` cheap enough to put on a cacheable response.
    assert.deepEqual(parse({ headers: { RSC: '0' } }), { kind: 'document' });
    assert.deepEqual(parse({ headers: { RSC: 'true' } }), { kind: 'document' });
    // An action id on a GET is not a shape the union can hold, and a GET must never run one.
    assert.deepEqual(parse({ headers: { 'x-rsc-action': 'abc' } }), { kind: 'document' });
  });

  test("a POST is a client-initiated action exactly when it carries 'x-rsc-action'", () => {
    // Which branch a POST takes is a security boundary, not just dispatch. `x-rsc-action` is not a
    // CORS-safelisted header, so a page on another origin cannot send one without a preflight the framework
    // never answers — which is why this branch carries no origin check of its own. If the classification
    // ever moved to something a cross-origin form *can* send, that defence would be gone with no test
    // failing anywhere else. See `SECURITY.md` and `refusesCrossSiteForm`.
    assert.deepEqual(parse({ method: 'POST', headers: { 'x-rsc-action': 'abc' }, body: '[]' }), { kind: 'rsc-action', actionId: 'abc' });
    // The header decides even when the body is form-shaped: a client-initiated call is not forgeable
    // whatever it is encoded as.
    assert.deepEqual(parse({ method: 'POST', headers: { 'x-rsc-action': 'abc', 'content-type': 'multipart/form-data; boundary=x' }, body: '' }), {
      kind: 'rsc-action',
      actionId: 'abc',
    });
    assert.deepEqual(parse({ method: 'POST', headers: { 'x-rsc-action': '' }, body: '[]' }), { kind: 'document' }, 'an empty id names nothing');
  });

  test('a POST is a form action exactly for the content types a browser can send cross-origin', () => {
    // These two need no preflight, which is what makes this the forgeable shape and the one
    // `refusesCrossSiteForm` stands in front of.
    for (const contentType of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=----x', 'MULTIPART/FORM-DATA; boundary=y']) {
      assert.deepEqual(parse({ method: 'POST', headers: { 'content-type': contentType }, body: 'x=1' }), { kind: 'form-action' }, contentType);
    }
    // Matched as a prefix, so the `; charset=UTF-8` a browser appends does not fall out of the branch — and
    // erring wide is the safe direction here: an over-matched POST lands on the guarded branch and decodes to
    // nothing, where an under-matched one would land on a branch with no origin check.
    assert.deepEqual(parse({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencodedX' }, body: 'x=1' }), {
      kind: 'form-action',
    });
    // Anything else is not an action at all — it renders the page and runs nothing, so a `text/plain` POST
    // without the header cannot reach an action however it is aimed.
    for (const contentType of ['application/json', 'text/plain', 'text/html', 'application/xml']) {
      assert.deepEqual(parse({ method: 'POST', headers: { 'content-type': contentType }, body: '{}' }), { kind: 'document' }, contentType);
    }
    assert.deepEqual(parse({ method: 'POST', body: 'x=1' }), { kind: 'document' }, 'no content-type at all');
  });

  test('what each shape means downstream', () => {
    const shapes = {
      document: parse({}),
      rsc: parse({ headers: { RSC: '1' } }),
      'form-action': parse({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x=1' }),
      'rsc-action': parse({ method: 'POST', headers: { 'x-rsc-action': 'abc' }, body: '[]' }),
    };
    assert.deepEqual(Object.fromEntries(Object.entries(shapes).map(([name, shape]) => [name, [wantsRsc(shape), isActionRequest(shape)]])), {
      document: [false, false],
      rsc: [true, false],
      // A no-JS form post answers with a document; a client-initiated call answers with a payload.
      'form-action': [false, true],
      'rsc-action': [true, true],
    });
  });

  test('isBrowserFormPost reads x-rsc-action the same way the classifier does', () => {
    // The two have to agree about this header, because one decides what is *refused* and the other decides
    // what is *decoded*: a POST the classifier sends down the form branch must be a POST the cross-site
    // refusal has already looked at. A present-but-empty `x-rsc-action` was the shape they disagreed on —
    // `has()` here said "the client-initiated shape, already covered by the preflight it would need", `get()`
    // there found nothing to dispatch on, and the request ran its action with the check skipped. Not
    // reachable from a browser, since an empty header still needs that preflight, but a security predicate
    // that fails open on a shape nothing sends today is one that fails open the day something does.
    const post = (headers, body = 'x=1') => new Request(BASE, { method: 'POST', headers, body });
    const formish = { 'content-type': 'application/x-www-form-urlencoded' };

    assert.equal(isBrowserFormPost(post(formish)), true, 'the plain form post');
    assert.equal(isBrowserFormPost(post({ ...formish, 'x-rsc-action': 'abc' })), false, 'a real action id is the unforgeable shape');
    assert.equal(isBrowserFormPost(post({ ...formish, 'x-rsc-action': '' })), true, 'an empty one names no action and forges nothing');

    // Stated as the invariant rather than as three cases: every POST the classifier calls a `form-action`
    // is one this returns true for, so the refusal cannot be routed around by the header the classifier
    // ignores. `text/plain` is deliberately outside it in the other direction — refused here, never decoded
    // there — which is why this is a one-way implication.
    for (const headers of [formish, { ...formish, 'x-rsc-action': '' }, { 'content-type': 'multipart/form-data; boundary=x' }]) {
      const request = post(headers);
      if (parseRenderRequest(request).kind === 'form-action') {
        assert.equal(isBrowserFormPost(request), true, `${JSON.stringify(headers)} decodes as a form action, so it must be checked as one`);
      }
    }
  });

  test('asksForRsc reads the same header without parsing the rest', () => {
    // The prerendered-page path takes it on every GET, so it never builds a `RenderRequest` it would drop.
    assert.equal(asksForRsc(new Request(BASE, { headers: { RSC: '1' } })), true);
    assert.equal(asksForRsc(new Request(BASE)), false);
    assert.equal(asksForRsc(new Request(BASE, { method: 'POST', headers: { 'x-rsc-action': 'abc' }, body: '[]' })), false, 'RSC, not the action id');
  });

  test('createRscRequest round-trips through the parser it is read by', () => {
    // `location` is the browser global the client runtime resolves a relative href against.
    const location = globalThis.location;
    globalThis.location = { origin: 'https://app.test' };
    try {
      const navigation = createRscRequest('/docs?q=1');
      assert.equal(navigation.method, 'GET');
      assert.equal(navigation.url, 'https://app.test/docs?q=1');
      assert.deepEqual(parseRenderRequest(navigation), { kind: 'rsc' });

      const action = createRscRequest('/docs', { id: 'abc123', body: '[]' });
      assert.equal(action.method, 'POST');
      assert.deepEqual(parseRenderRequest(action), { kind: 'rsc-action', actionId: 'abc123' });
      // The header the whole cross-origin argument rests on has to be the one actually sent.
      assert.equal(action.headers.get('x-rsc-action'), 'abc123');
      assert.equal(action.headers.get('rsc'), '1');
    } finally {
      if (location === undefined) delete globalThis.location;
      else globalThis.location = location;
    }
  });
});

describe('the security-middleware build warning', () => {
  /**
   * The minimal app somewhere disposable, plus whatever `src/server.ts` the case wants.
   *
   * No `node_modules`: `createViteConfig` builds config objects and scans `src/`, and resolves packages from
   * the *framework's* tree rather than the app's, so nothing here reads one. It used to borrow the
   * fixture's through a junction, which was both unnecessary and a Windows reparse point for no reason.
   */
  function appWithServer(serverSource) {
    const dir = mkdtempSync(join(tmpdir(), 'rsvhono-warn-'));
    cpSync(join(MINIMAL_APP_DIR, 'package.json'), join(dir, 'package.json'));
    cpSync(join(MINIMAL_APP_DIR, 'src'), join(dir, 'src'), { recursive: true });
    if (serverSource !== null) writeFileSync(join(dir, 'src', 'server.ts'), serverSource);
    after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  /** What `createViteConfig` warns about for `rootDir`, as one string. Builds only — `dev` says nothing. */
  function warningsFor(rootDir, { isDev = false } = {}) {
    const warn = console.warn;
    const lines = [];
    console.warn = (...args) => lines.push(args.join(' '));
    try {
      createViteConfig({ rootDir, isDev, config: {}, preset: NODE_PRESET });
    } finally {
      console.warn = warn;
    }
    return lines.join('\n');
  }

  test('an app with no src/server.ts is told it has neither control', () => {
    assert.match(warningsFor(MINIMAL_APP_DIR), /No src\/server\.ts/);
  });

  test('an app whose src/server.ts never registers bodyLimit is told about the body cap', () => {
    // Having a src/server.ts is not the same as having the cap in it, and this half used to be warned
    // about nowhere: the first check only ever asked whether the file existed. Every `'use server'`
    // export is a public POST endpoint, and the action path buffers the whole body before it can decide
    // anything about it.
    const dir = appWithServer("import { Hono } from 'hono';\nexport default new Hono();\n");
    const warnings = warningsFor(dir);
    assert.match(warnings, /No bodyLimit\(\) anywhere in src\//);
    assert.doesNotMatch(warnings, /No src\/server\.ts/, 'the file is there — only the cap is missing');
  });

  test('the scan is the whole of src/, so a cap registered from a helper module counts', () => {
    // A textual scan of one file would call this app unprotected. The failure mode of getting it wrong is
    // a warning nobody needed, so it reads wide rather than narrow.
    const dir = appWithServer("import { Hono } from 'hono';\nimport { security } from './security';\nexport default new Hono().use(security());\n");
    writeFileSync(
      join(dir, 'src', 'security.ts'),
      "import { bodyLimit } from 'hono/body-limit';\nexport const security = () => bodyLimit({ maxSize: 1024 });\n",
    );
    assert.equal(warningsFor(dir), '', 'a registered cap must not be reported as missing');
  });

  test('the testbed, which registers both, is warned about nothing — and dev is never warned at all', () => {
    assert.equal(warningsFor(TESTBED_DIR), '');
    assert.equal(warningsFor(MINIMAL_APP_DIR, { isDev: true }), '', 'a rebuild would print it every time');
  });
});

describe('validateRoutesModule', () => {
  // The app's own `src/routes.ts`, checked before anything is built on it. Everything below either
  // crashed somewhere unrelated (`nN is not iterable`, from a minified bundle) or did nothing at all.
  const page = { path: '/', component: () => Promise.resolve({ default: () => null }) };
  const endpoint = { type: 'endpoint', path: '/api/x', server: () => Promise.resolve({ handler: () => null }) };
  const rejects = (exported, expected) => assert.throws(() => validateRoutesModule(exported), expected);

  test('accepts both shapes the docs present, so leaving off defineRoutes is not a trap', () => {
    assert.deepEqual(validateRoutesModule([page]), { routes: [page] });
    const config = { routes: [page], notFound: { component: page.component } };
    assert.equal(validateRoutesModule(config), config, 'a config is returned as it came');
  });

  test('names src/routes.ts when the export is not a route table at all', () => {
    for (const exported of [undefined, null, 42, {}, { routes: 'nope' }]) {
      rejects(exported, /\[rsvhono\] src\/routes\.ts must export `routes`/);
    }
  });

  test('names the entry that is wrong, by position and by path', () => {
    rejects([page, null], /routes\[1\] is null, not a route object/);
    rejects([page, { component: page.component }], /routes\[1\] needs a `path` starting with "\/"/);
    rejects([{ path: 'docs', component: page.component }], /routes\[0\] \("docs"\) needs a `path` starting with "\/"/);
    rejects([{ path: '/x' }], /routes\[0\] \("\/x"\) needs `component`/);
    rejects([{ type: 'page', path: '/x', component: page.component }], /the only `type` is 'endpoint'/);
    rejects([{ type: 'endpoint', path: '/api/x' }], /is an endpoint, so it needs `server`/);
  });

  // Excess-property checking against a union accepts any key present in *some* member, so these
  // type-check today and are then silently ignored — which looks exactly like a feature not working.
  test('refuses a key that belongs to the other kind of route', () => {
    rejects([{ ...endpoint, render: 'static' }], /has `render`, which only a page route has/);
    rejects([{ ...endpoint, staticPaths: async () => [] }], /has `staticPaths`, which only a page route has/);
    rejects([{ ...page, method: 'get' }], /has `method`, which only an endpoint route has/);
    rejects([{ ...page, server: endpoint.server }], /has `server`, which only an endpoint route has/);
  });

  test('refuses a staticPaths the build would never call', () => {
    rejects([{ ...page, path: '/docs/:slug', staticPaths: async () => [{ slug: 'a' }] }], /is not `render: 'static'`/);
    rejects([{ ...page, render: 'static', staticPaths: 'nope' }], /`staticPaths` that is not a function/);
    rejects([{ ...page, render: 'lazy' }], /has render "lazy" — it is 'static' or 'dynamic'/);
  });

  test("refuses a method the router cannot match, and points 'head' at 'get'", () => {
    rejects([{ ...endpoint, method: 'HEAD' }], /has method "HEAD", which is not one of get, post/);
    rejects([{ ...endpoint, method: 'head' }], /A HEAD is dispatched as a GET, so use 'get'/);
  });

  test('takes a list of methods, and refuses the lists that are mistakes', () => {
    assert.deepEqual(validateRoutesModule([{ ...endpoint, method: ['get', 'delete'] }]).routes[0].method, ['get', 'delete']);
    // Named member by member, so the message points at the bad one rather than printing the array.
    rejects([{ ...endpoint, method: ['get', 'HEAD'] }], /has method "HEAD", which is not one of get, post/);
    rejects([{ ...endpoint, method: [] }], /has an empty `method` list/);
    rejects([{ ...endpoint, method: ['get', 'all'] }], /has 'all' inside a `method` list/);
  });

  // The one that built cleanly, exited 0 and said nothing: Hono matches in registration order.
  test('refuses a route every method of which the table already answers', () => {
    rejects(
      [page, { ...page, component: page.component }],
      /routes\[1\] \("\/"\) would never run — routes\[0\] \("\/"\) already answers GET, POST \//,
    );
    rejects([endpoint, { ...endpoint, method: 'get' }], /already answers GET \/api\/x/, 'an `all` endpoint claims every method');
    rejects(
      [
        { ...endpoint, method: ['get', 'post'] },
        { ...endpoint, method: 'post' },
      ],
      /already answers POST \/api\/x/,
      'a listed method is claimed like any other',
    );
    rejects([{ ...endpoint, path: '/' }, page], /already answers GET, POST \//, 'an endpoint shadows a page at the same path too');
  });

  test('sees a dead route whose path is spelled differently from the one that shadows it', () => {
    // The check used to key on the literal path string, so a dead route only had to be spelled differently
    // to pass — exactly the build-exits-0-with-an-unreachable-route case it exists to prevent. Every pair
    // below was confirmed against Hono 4.13 directly: the second route never wins for any request.
    const at = (path) => ({ ...page, path });
    for (const [table, expected, what] of [
      [[at('/u/:id'), at('/u/:name')], /routes\[1\] \("\/u\/:name"\) would never run/, "a parameter's name is not part of the pattern"],
      [[at('/posts/:y/:m'), at('/posts/:a/:b')], /routes\[1\] .* would never run/, 'two parameters, both renamed'],
      [[at('/a/*'), at('/a/b')], /routes\[1\] \("\/a\/b"\) would never run/, 'a wildcard registered ahead of a concrete path'],
      [[at('/a/*'), at('/a')], /routes\[1\] \("\/a"\) would never run/, 'a trailing wildcard answers its bare prefix too'],
      [[at('/*'), at('/anything')], /routes\[1\] .* would never run/, 'a root wildcard claims everything after it'],
      [[at('/u/:id/*'), at('/u/:name/x')], /routes\[1\] .* would never run/, 'both mechanisms at once'],
      [[at('/a/*/c'), at('/a/:id/c')], /routes\[1\] .* would never run/, 'a `*` before the last segment is one segment, like a parameter'],
      [[at('/a/:id?'), at('/a')], /routes\[1\] \("\/a"\) would never run/, 'an optional parameter answers the path without it'],
    ]) {
      rejects(table, expected, what);
    }

    // And says why, since two paths that look different reading as one route is the confusing part.
    rejects([at('/u/:id'), at('/u/:name')], /Hono matches on the pattern, not the spelling/);
    // An exact duplicate needs no explaining, so it does not get the sentence.
    assert.throws(
      () => validateRoutesModule([at('/u/:id'), at('/u/:id')]),
      (error) => !error.message.includes('not the spelling'),
      'an exact duplicate is self-explanatory',
    );
  });

  test('compares a {regex} constraint as text, and stops there', () => {
    const at = (path) => ({ ...page, path });
    // Kept in the key, because a constraint *is* part of the pattern — so two spellings of one constraint
    // are one route and the second is dead.
    rejects([at('/a/:id{[0-9]+}'), at('/a/:n{[0-9]+}')], /routes\[1\] .* would never run/, 'the same constraint under two parameter names');
    rejects(
      [at('/a/:id{a/b}'), at('/a/:n{a/b}')],
      /routes\[1\] .* would never run/,
      'a constraint holding a slash is carried through, not interpreted',
    );

    // And this is the line: `[0-9]+` and `\d+` are the same language, the second route is dead, and the check
    // accepts it. Deciding regex equivalence is not a route validator's job, and the failure mode is the
    // safe one — an unreachable route slips through, a route that can still answer is never refused.
    assert.doesNotThrow(() => validateRoutesModule([at('/a/:id{[0-9]+}'), at('/a/:id{\\d+}')]));
  });

  test('leaves a route that still answers something alone', () => {
    for (const table of [
      // A `{regex}` constraint *is* part of the pattern, so these are two routes and both can answer:
      // `/a/7` goes to the first and `/a/xy` to the second.
      [
        { ...page, path: '/a/:id{[0-9]+}' },
        { ...page, path: '/a/:name' },
      ],
      // Specific-behind-generic is the dead one; generic behind specific still answers everything else.
      [
        { ...page, path: '/a/b' },
        { ...page, path: '/a/*' },
      ],
      // The wildcard's boundary is the `/` — `/a/*` does not answer `/ab`.
      [
        { ...page, path: '/a/*' },
        { ...page, path: '/ab' },
      ],
      // `/a/:id?` answers `/a` as well as `/a/x`, so a bare `/a` ahead of it leaves it half its work.
      [
        { ...page, path: '/a' },
        { ...page, path: '/a/:id?' },
      ],
      // A wildcard claims one subtree, not the table.
      [
        { ...page, path: '/a/*' },
        { ...page, path: '/b/c' },
      ],
      // One path split across two methods — an ordinary thing to write.
      [
        { ...endpoint, method: 'get' },
        { ...endpoint, method: 'post' },
        { ...page, path: '/other' },
      ],
      // A catch-all behind a route claiming one method of the path: it still answers PUT, DELETE, …
      [{ ...endpoint, method: 'post' }, endpoint],
      // And behind one claiming two of them.
      [{ ...endpoint, method: ['get', 'post'] }, endpoint],
      // Overlapping *patterns* are the router's business, and specific-before-generic is the point.
      [
        { ...page, path: '/docs/getting-started' },
        { ...page, path: '/docs/:slug' },
      ],
    ]) {
      assert.deepEqual(validateRoutesModule(table).routes, table);
    }
  });

  test('refuses a route under the /_static prefix the framework mounts ahead of the table', () => {
    // The failure this check exists to prevent, one prefix out of its reach: the shadow check compares the
    // app's routes with each other, and `mountStaticAssets` registers `/_static` *before* any of them and
    // ends in a terminal 404. So these built clean and then 404'd — on all four deploy targets and in dev.
    const at = (path) => ({ ...page, path });
    rejects([at('/_static')], /routes\[0\] \("\/_static"\) would never run — the framework serves the client bundle at \/_static/);
    rejects([at('/_static/thing')], /would never run/, 'and anything below it');
    rejects([{ ...endpoint, path: '/_static/api' }], /would never run/, 'an endpoint is mounted no earlier than a page');
    rejects([at('/_static/*')], /would never run/, 'a wildcard under the prefix is dead the same way');
    rejects([at('/_static')], /reserved on every deploy target and under `rsvhono dev`/, 'and says where it is reserved');

    // The boundary is the `/`, and only a *literal* path is refused: a parameterised route that happens to
    // match under the prefix loses those requests and answers everything else, which is the router's
    // business rather than this rule's. Refusing one of these would fail a build that was correct.
    for (const path of ['/_staticky', '/_static-files', '/:section/thing', '/*', '/x/_static']) {
      assert.deepEqual(validateRoutesModule([at(path)]).routes[0].path, path, path);
    }
  });

  test('checks the two framework-owned pages as well', () => {
    rejects({ routes: [page], notFound: {} }, /`notFound` must be a page/);
    rejects({ routes: [page], error: () => null }, /`error` must be a page/);
  });
});

describe('validateServerApp', () => {
  test('takes the Hono app, or nothing where the app has no src/server.ts', () => {
    // What the empty fallback module the alias resolves to default-exports.
    assert.equal(validateServerApp({ default: null }), null);
    assert.equal(validateServerApp({}), null);
    assert.equal(validateServerApp(null), null);
    const app = { fetch: () => null, routes: [] };
    assert.equal(validateServerApp({ default: app }), app);
  });

  test('names src/server.ts rather than letting Hono throw from inside app.route()', () => {
    for (const value of [{ notAHono: true }, 'nope', 42, { fetch: () => null }]) {
      assert.throws(() => validateServerApp({ default: value }), /\[rsvhono\] src\/server\.ts must `export default` a Hono app/);
    }
  });
});
/*
 * The checks a route's *own* module gets. `rsvhono build` runs these against every route once the bundle
 * exists; before that they only ran on first request, so a page module that could never render — a
 * `'use client'` page, a missing default export — shipped behind a green build and answered 500 for the life
 * of the deployment. The endpoint half had no check at all: it destructured `handler` and called it, which
 * turns a method-named export into `TypeError: r is not a function` from a minified frame.
 */
describe('assertRouteModules', () => {
  /** What a page module's default export looks like once the build has wrapped it. */
  const serverPage = Object.assign(() => null, { $$rsvhonoPage: true });
  /** And what a `'use client'` one looks like — a client reference. */
  const clientPage = Object.assign(() => null, { $$typeof: Symbol.for('react.client.reference') });

  const page = (path, mod) => ({ path, component: () => Promise.resolve(mod) });
  const endpoint = (path, mod) => ({ path, type: 'endpoint', server: () => Promise.resolve(mod) });

  test('accepts a table whose every module is what it claims to be', async () => {
    await assertRouteModules({
      routes: [page('/', { default: serverPage }), endpoint('/api/health', { handler: () => null })],
      notFound: { component: () => Promise.resolve({ default: serverPage }) },
      error: { component: () => Promise.resolve({ default: serverPage }) },
    });
  });

  test('refuses a page the build did not wrap, since it would render without ctx', async () => {
    // A server component that reaches the route table some way the build does not recognise — not an inline
    // thunk, no `'use server-entry'`. Unwrapped, the RSC plugin's stylesheet wrapper could drop its `ctx`.
    await assert.rejects(
      assertRouteModules({ routes: [page('/unmarked', { default: () => null })] }),
      /\[rsvhono\] The page component for "\/unmarked" was not built as a page \('use server-entry'\)/,
    );
  });

  test('refuses a page module with no default export', async () => {
    await assert.rejects(
      assertRouteModules({ routes: [page('/noexport', { Page: serverPage })] }),
      /\[rsvhono\] The page module for "\/noexport" must default-export a server component\./,
    );
  });

  test("refuses a 'use client' page", async () => {
    await assert.rejects(
      assertRouteModules({ routes: [page('/clientpage', { default: clientPage })] }),
      /\[rsvhono\] The page component for "\/clientpage" is a client component/,
    );
  });

  test('refuses an endpoint module that exports anything but `handler`', async () => {
    await assert.rejects(assertRouteModules({ routes: [endpoint('/api/bad', { GET: () => null })] }), (error) => {
      assert.match(error.message, /\[rsvhono\] The endpoint module for "\/api\/bad" must export `handler`/);
      assert.match(error.message, /a method-named export \(`GET`, `POST`\) is never read/, 'the mistake people actually make');
      return true;
    });
  });

  test('checks the notFound and error pages too, which the request path only reaches once something failed', async () => {
    await assert.rejects(
      assertRouteModules({ routes: [], notFound: { component: () => Promise.resolve({ default: clientPage }) } }),
      /The page component for the notFound page is a client component/,
    );
    await assert.rejects(
      assertRouteModules({ routes: [], error: { component: () => Promise.resolve({}) } }),
      /The page module for the error page must default-export/,
    );
  });

  test('names every broken route at once, so fixing four of them costs one build', async () => {
    await assert.rejects(
      assertRouteModules({
        routes: [page('/ok', { default: serverPage }), page('/clientpage', { default: clientPage }), page('/noexport', {})],
      }),
      (error) => {
        assert.match(error.message, /\[rsvhono\] 2 route modules cannot serve a request:/);
        assert.match(error.message, /• The page component for "\/clientpage"/);
        assert.match(error.message, /• The page module for "\/noexport"/);
        assert.doesNotMatch(error.message, /"\/ok"/, 'a route that is fine must not be listed');
        return true;
      },
    );
  });

  test('warns rather than failing when a module cannot be imported, and checks every other route anyway', async () => {
    // Checking a module's shape means importing it, and an import that throws is a fact about the build
    // environment as much as about the module: a page whose module scope reads a secret or opens a
    // connection fails here and serves per request. A `render: 'static'` route is the one that cannot get
    // away with it, and the prerender pass is what says so.
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      await assertRouteModules({
        routes: [
          { path: '/side-effect', component: () => Promise.reject(new Error('DATABASE_URL is not set')) },
          page('/ok', { default: serverPage }),
        ],
      });
      await assert.rejects(
        assertRouteModules({
          routes: [{ path: '/side-effect', component: () => Promise.reject(new Error('nope')) }, page('/clientpage', { default: clientPage })],
        }),
        /The page component for "\/clientpage" is a client component/,
        'a route it could not load must not stop it checking the rest',
      );
    } finally {
      console.warn = warn;
    }
    assert.match(warnings.join('\n'), /"\/side-effect" could not be loaded at build time, so its module was not checked — DATABASE_URL is not set/);
  });
});

// The CLI's failure paths print the report that says what went wrong and then exit. `process.exit` does not
// drain a pipe — every CI job, and any `rsvhono build | tee` — so everything past the 64 KiB pipe buffer used
// to be discarded, cutting a large build error dump mid-error.
describe('exit', () => {
  const EXIT_MODULE = new URL('../dist/cli/exit.js', import.meta.url).href;
  const spawnWriting = (bytes, exiting) =>
    spawnSync(
      process.execPath,
      [
        '-e',
        `import('${EXIT_MODULE}').then(async ({ exit }) => {
           console.error('E'.repeat(${bytes}));
           ${exiting}
         })`,
      ],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );

  test('a piped stream is drained before the process goes away', () => {
    const bytes = 300_000;
    const drained = spawnWriting(bytes, 'await exit(1);');
    assert.equal(drained.status, 1, 'the exit code still has to be the one asked for');
    assert.equal(drained.stderr.length, bytes + 1, 'every byte written must reach the pipe');

    // The same write without the helper, so the assertion above is measuring the drain and not a pipe
    // that was never small enough to matter on this machine. Only POSIX: a write to a pipe is synchronous
    // on Windows, so there is nothing there for a bare exit to drop and nothing for the drain to rescue.
    if (process.platform !== 'win32') {
      const cut = spawnWriting(bytes, 'process.exit(1);');
      assert.ok(cut.stderr.length < bytes, `a bare process.exit is what truncates (${cut.stderr.length} bytes)`);
    }
  });

  // The helper being right is half of it; every failure path in the CLI reaching it is the other half, and
  // that is what drifted — four paths printed their one line and called `process.exit` directly, so the
  // rule held for the paths that had been thought about and not for the ones added since. A structural pin
  // rather than four spawns, because what matters is that there is no fifth.
  test('nothing in the CLI calls process.exit except the helper that drains first', () => {
    const cliDir = fileURLToPath(new URL('../dist/cli/', import.meta.url));
    const offenders = readdirSync(cliDir)
      .filter((name) => name.endsWith('.js') && name !== 'exit.js')
      .filter((name) => /\bprocess\.exit\s*\(/.test(readFileSync(join(cliDir, name), 'utf8')));
    assert.deepEqual(offenders, [], 'these must `return exit(code)` instead — a piped stderr drops what a bare exit leaves behind');
  });
});

describe('shadowProcessEnv', () => {
  const options = { env: { NODE_ENV: 'production', PUBLIC_URL: 'https://example.test' }, nodeEnv: 'production' };
  const PRELUDE = `const process = Object.assign(Object.create(globalThis.process ?? Object.prototype), { env: ${JSON.stringify(options.env)} }); `;
  const run = (source) => shadowProcessEnv(source, options);

  test('leaves a module that never mentions process untouched', () => {
    assert.equal(run('export const x = 1;'), null);
    // A word that merely contains it is not a mention.
    for (const source of ['export const x = preprocess(1);', 'export const x = processEnv;', "import cp from 'node:child_process';"]) {
      assert.equal(run(source), null, `"${source}" must not drag the prelude in`);
    }
  });

  test('shadows every shape that reads the env through the process binding, not just the literal process.env', () => {
    // A `define` on `process.env` sees the first two of these. The prelude replaces the whole binding.
    for (const source of [
      'export const x = process.env.DATABASE_URL;',
      'const { DATABASE_URL } = process.env;',
      'export const x = process?.env.DATABASE_URL;',
      "export const x = process['env'].DATABASE_URL;",
      'const { env } = process;',
      'const p = process; export const x = p.env.DATABASE_URL;',
      "export const x = typeof process !== 'undefined' ? process.env.DATABASE_URL : '';",
    ]) {
      assert.equal(run(source), PRELUDE + source, `"${source}" must be shadowed`);
    }
  });

  test('the shadow really hides a secret, and keeps the rest of process', () => {
    process.env.SHADOW_UNIT_SECRET = 'hunter2';
    try {
      const read = new Function(`${run('return [process?.env.SHADOW_UNIT_SECRET, process.env.PUBLIC_URL, typeof process.version];')}`);
      assert.deepEqual(read(), [undefined, 'https://example.test', 'string']);
    } finally {
      delete process.env.SHADOW_UNIT_SECRET;
    }
  });

  test('goes after the whole directive prologue, so no directive stops being one', () => {
    for (const prologue of ["'use client';\n", '"use strict";\n\'use client\';\n', "// a comment\n'use client';\n"]) {
      const out = run(`${prologue}export const x = process.env.A;`);
      assert.equal(out, `${prologue}${PRELUDE}export const x = process.env.A;`);
    }
  });

  test('hands process.env.NODE_ENV back as a literal, in code and nowhere else', () => {
    assert.equal(run("if (process.env.NODE_ENV === 'production') a();"), `${PRELUDE}if ("production" === 'production') a();`);
    const untouched = ["throw new Error('set process.env.NODE_ENV');", 'x(`process.env.NODE_ENV`, process);', 'this.process.env.NODE_ENV; process;'];
    for (const source of untouched) assert.equal(run(source), PRELUDE + source, source);
    assert.match(run('process; // process.env.NODE_ENV'), /\/\/ process\.env\.NODE_ENV$/, 'a comment is prose');
  });

  test('a read through the global object is recognised, since no binding can shadow it', () => {
    for (const source of ['globalThis.process.env.X', 'globalThis?.process', "global['process'].env", 'self.process']) {
      assert.equal(readsGlobalProcess(source), true, source);
    }
    assert.equal(readsGlobalProcess('process.env.X'), false);
  });
});

describe('route-functions: reading the manifest', async () => {
  const { createReferenceValidation, joinRouteFunctions, reachableFunctions, UnreachableServerReferenceError } =
    await import('../dist/runtime/route-functions.js');

  const manifest = joinRouteFunctions(
    { 'pages/a.tsx': ['m1#save'], 'pages/b.tsx': ['m2#remove', 'm2#rename'], 'pages/plain.tsx': [] },
    { '/a': 'pages/a.tsx', '/b/:id': 'pages/b.tsx', '/plain': 'pages/plain.tsx', '/no-key': undefined, '/not-walked': 'pages/gone.tsx' },
    ['m1#save', 'm2#remove', 'm2#rename', 'm3#orphan'],
  );

  test('a route is joined to its page’s functions, and a function no route reaches is named', () => {
    assert.deepEqual(manifest.routes, { '/a': ['m1#save'], '/b/:id': ['m2#remove', 'm2#rename'], '/plain': [] });
    assert.deepEqual(manifest.unreachable, ['m3#orphan']);
  });

  test('a route that could not be traced is unresolved, never empty and never everything', () => {
    // No key on the page module, and a key the graph walk never recorded.
    assert.deepEqual(manifest.unresolved, ['/no-key', '/not-walked']);
    assert.equal(reachableFunctions(manifest, '/no-key'), undefined);
    assert.equal(reachableFunctions(manifest, '/never-heard-of'), undefined);
    // As distinct from a page that was traced and reaches nothing.
    assert.deepEqual([...reachableFunctions(manifest, '/plain')], []);
    assert.equal(reachableFunctions(manifest, '__proto__'), undefined);
  });

  test('a function another route reaches is refused as the call and as a reference inside it', () => {
    const fromA = createReferenceValidation(reachableFunctions(manifest, '/a'));
    fromA.assertReachable('m1#save');
    fromA.onServerReference({ id: 'm1', name: 'save' });
    // The function the request names…
    assert.throws(() => fromA.assertReachable('m2#remove'), UnreachableServerReferenceError);
    // …and one that only turns up while decoding: an argument, or something bound to the action.
    assert.throws(() => fromA.onServerReference({ id: 'm2', name: 'remove' }), /m2#remove is not reachable/);
  });

  test('not knowing what a route reaches refuses every reference', () => {
    const unknown = createReferenceValidation(reachableFunctions(manifest, '/no-key'));
    assert.throws(() => unknown.assertReachable('m1#save'), UnreachableServerReferenceError);
    assert.throws(() => unknown.onServerReference({ id: 'm1', name: 'save' }), UnreachableServerReferenceError);
  });
});
