// The harness's own arithmetic and plumbing. A benchmark whose statistics are wrong is wrong everywhere at
// once and looks fine, so the parts every table goes through are tested the ordinary way.
//
//   pnpm --filter @rsvhono/benchmarks test
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { describe as suite, test } from 'node:test';
import { describe, geomean, isTie, ratio, ratioCell, sample, summaryLine } from '../harness/lib/stats.mjs';
import { startEdge } from '../harness/lib/edge.mjs';
import { BROWSER_PROFILES, SERVER_ENVIRONMENTS, pick } from '../harness/lib/environments.mjs';
import { treeCpuMs } from '../harness/lib/cpu.mjs';
import { fine, gridSection } from '../harness/lib/report-environments.mjs';

suite('describe', () => {
  const summary = describe([4, 1, 3, 2, 5], { batchSize: 8, name: 'five' });

  test('carries the fields a MoonBit Summary does, under the same names', () => {
    assert.deepEqual(Object.keys(summary), [
      'name',
      'runs',
      'batch_size',
      'sum',
      'min',
      'max',
      'mean',
      'median',
      'var',
      'std_dev',
      'std_dev_pct',
      'median_abs_dev',
      'median_abs_dev_pct',
      'quartiles',
      'iqr',
    ]);
  });

  test('and they are the right numbers', () => {
    assert.equal(summary.runs, 5);
    assert.equal(summary.batch_size, 8);
    assert.equal(summary.sum, 15);
    assert.equal(summary.min, 1);
    assert.equal(summary.max, 5);
    assert.equal(summary.mean, 3);
    assert.equal(summary.median, 3);
    assert.equal(summary.var, 2.5, 'the sample variance, n − 1');
    assert.ok(Math.abs(summary.std_dev - Math.sqrt(2.5)) < 1e-12);
    assert.equal(summary.median_abs_dev, 1);
    assert.deepEqual(summary.quartiles, [2, 3, 4]);
    assert.equal(summary.iqr, 2);
  });

  test('one sample has no spread, and no samples have no summary', () => {
    assert.equal(describe([7]).std_dev, 0);
    assert.equal(describe([]), null);
  });

  test('prints as mean ± σ, range, runs × batch', () => {
    assert.match(
      summaryLine(summary, (v) => `${v.toFixed(1)}ms`),
      /^3\.0ms ± 1\.6ms {3}1\.0ms … 5\.0ms {2}in 5 × 8 runs$/,
    );
  });
});

suite('sample', () => {
  test('grows the batch until one batch is long enough to time', async () => {
    let calls = 0;
    const fast = await sample(async () => void calls++, { samples: 4, minBatchMs: 5, warmup: 0 });
    assert.ok(fast.batchSize > 1, `a call that takes no time is batched (${fast.batchSize})`);
    assert.equal(fast.samples.length, 4);
    assert.ok(calls >= fast.batchSize * 4);

    const slow = await sample(() => new Promise((resolve) => setTimeout(resolve, 12)), { samples: 3, minBatchMs: 10, warmup: 0 });
    assert.equal(slow.batchSize, 1, 'a call already longer than the minimum is its own batch');
    for (const value of slow.samples) assert.ok(value >= 10 && value < 60, `each sample is one call's time (${value})`);
  });

  test('a sample is the mean of its batch, not its total', async () => {
    const { samples, batchSize } = await sample(() => new Promise((resolve) => setTimeout(resolve, 2)), { samples: 3, minBatchMs: 20, warmup: 0 });
    assert.ok(batchSize >= 4);
    for (const value of samples) assert.ok(value >= 1.5 && value < 15, String(value));
  });

  test('the batch stops growing at its cap', async () => {
    const { batchSize } = await sample(async () => {}, { samples: 1, minBatchMs: 10_000, maxBatch: 64, warmup: 0 });
    assert.equal(batchSize, 64);
  });
});

suite('ratio', () => {
  const tight = (around) => Array.from({ length: 12 }, (_, n) => around + (n % 3) * 0.01);

  test('is the ratio of medians', () => {
    assert.ok(Math.abs(ratio(tight(20), tight(10)).ratio - 2) < 0.01);
  });

  test('a clear difference has an interval that excludes 1', () => {
    const r = ratio(tight(20), tight(10));
    assert.ok(r.low > 1.9 && r.high < 2.1, `${r.low} … ${r.high}`);
    assert.equal(isTie(r), false);
  });

  test('two samples of the same thing are a tie, whatever the point estimate', () => {
    const noisy = [9, 11, 10, 12, 8, 10.5, 9.5, 11.5];
    const alsoNoisy = [10, 9, 12, 11, 8.5, 10.2, 11.8, 9.4];
    const r = ratio(noisy, alsoNoisy);
    assert.ok(r.low <= 1 && r.high >= 1);
    assert.equal(isTie(r), true);
  });

  test('the same samples give the same interval every time', () => {
    const a = [3, 4, 5, 4.5, 3.5, 4.2];
    const b = [2, 2.5, 3, 2.2, 2.8, 2.4];
    assert.deepEqual(ratio(a, b), ratio(a, b), 'a report regenerated from one result file does not move');
  });

  test('too few samples give a ratio and no interval, which is not a tie and not a win', () => {
    const r = ratio([4, 4], [2, 2]);
    assert.deepEqual(r, { ratio: 2, low: null, high: null });
    assert.equal(isTie(r), false);
    assert.equal(ratioCell(r), '2.00×');
  });

  test('nothing to compare is nothing', () => {
    assert.equal(ratio([], [1, 2, 3]), null);
    assert.equal(ratio([1, 2, 3], undefined), null);
    assert.equal(ratio([1, 2, 3], [0, 0, 0]), null, 'a zero reference has no multiples');
    assert.equal(ratioCell(null), '—');
  });

  test('prints with its interval', () => {
    assert.equal(ratioCell({ ratio: 1.254, low: 1.238, high: 1.271 }), '1.25× [1.24, 1.27]');
  });
});

suite('geomean', () => {
  test('twice as slow and twice as fast come out even', () => {
    assert.ok(Math.abs(geomean([2, 0.5]) - 1) < 1e-12);
    assert.ok(Math.abs(geomean([4, 1, 0.25]) - 1) < 1e-12);
  });

  test('an arithmetic mean of the same ratios would not', () => {
    assert.equal((2 + 0.5) / 2, 1.25);
  });

  test('rows without a figure are left out rather than counted as zero', () => {
    assert.ok(Math.abs(geomean([2, null, 8, undefined, 0]) - 4) < 1e-12);
    assert.equal(geomean([]), null);
  });
});

suite('the grid', () => {
  const unloaded = (values) => ({ samples: values });
  const sections = {
    matrix: {
      settings: { swept: [] },
      environments: {
        roomy: {
          label: 'all cores',
          targets: {
            a: { unloaded: { ssr: unloaded([10, 10.1, 10.2, 9.9, 10]), api: unloaded([1, 1.01, 0.99, 1, 1.02]) } },
            b: { unloaded: { ssr: unloaded([20, 20.2, 19.8, 20.1, 20]), api: unloaded([0.5, 0.51, 0.49, 0.5, 0.5]) } },
            c: { unloaded: { ssr: unloaded([10.05, 9.95, 10.1, 10, 10.2]) } },
          },
        },
        skipped: { label: 'one core', skipped: 'no taskset', targets: {} },
      },
    },
  };
  const text = gridSection(sections, ['a', 'b', 'c'], ['A', 'B', 'C']).join('\n');

  test('the reference is 1× and says why it is the reference', () => {
    assert.match(text, /\| `\/ssr` +\| 1× /);
    assert.match(text, /it is the reference because this is its repository/);
    assert.match(text, /measured by the project that maintains one of the four/);
  });

  test('a difference is shown with its interval, and a tie is marked', () => {
    assert.match(text, /\| `\/ssr` +\| 1× +\| 2\.0\d× \[1\.9\d, 2\.0\d\] +\| ≈ 1\.0\d× \[/);
  });

  test('a mean is over the rows every target has: one twice as slow, one twice as fast, but only the first counts for all four', () => {
    // `/api/health` has no figure for C, so it is in no column's mean — B's mean is 2×, not the 1× that its
    // two rows would average to.
    assert.match(text, /\*\*geometric mean\*\* \| \*\*1\.00×\*\* \| \*\*2\.0\d×\*\* +\| \*\*1\.0\d×\*\*/);
    assert.match(text, /\| `\/api\/health` +\| 1× +\| 0\.50× \[[^\]]+\] \| — /);
  });

  test('an environment that was skipped contributes no rows', () => {
    assert.doesNotMatch(text, /one core/);
  });

  test('no results, no section', () => {
    assert.deepEqual(gridSection({}, ['a'], ['A']), []);
  });
});

suite('formatting', () => {
  test('fine() keeps the digits that tell two fast things apart', () => {
    assert.equal(fine(0.314), '0.31 ms');
    assert.equal(fine(5.62), '5.62 ms');
    assert.equal(fine(42.37), '42.4 ms');
    assert.equal(fine(420.4), '420 ms');
    assert.equal(fine(1830), '1.83 s');
    assert.equal(fine(null), '—');
  });
});

suite('environments', () => {
  test('every environment says whether it can run here, and why not when it cannot', () => {
    for (const environment of SERVER_ENVIRONMENTS) {
      assert.equal(typeof environment.available, 'boolean', environment.id);
      if (!environment.available) assert.ok(environment.unavailableBecause, `${environment.id} explains itself`);
    }
  });

  test('a pinned environment wraps the start command; the others leave it alone', () => {
    for (const environment of SERVER_ENVIRONMENTS)
      assert.deepEqual(environment.wrap, environment.pinned ? ['taskset', '-c', '0'] : [], environment.id);
  });

  test('the heap budget is in the server’s NODE_OPTIONS, except where the runtime has no such flag', () => {
    for (const environment of SERVER_ENVIRONMENTS) {
      if (environment.heapMb) assert.match(environment.env.NODE_OPTIONS, new RegExp(`--max-old-space-size=${environment.heapMb}\\b`), environment.id);
      else assert.equal(environment.env.NODE_OPTIONS, '', `${environment.id} is given no Node flags`);
    }
  });

  test('the throttling figures are Lighthouse’s', () => {
    const mid = BROWSER_PROFILES.find((profile) => profile.id === 'mobile-mid');
    assert.equal(mid.cpu, 4);
    assert.equal(mid.network.latency, 150);
    assert.equal(Math.round(((mid.network.downloadThroughput * 8) / 1024 / 1024) * 10) / 10, 1.6);
    assert.equal(BROWSER_PROFILES.find((profile) => profile.id === 'desktop').network, null);
  });

  test('pick() chooses by id and refuses an id it does not know', () => {
    assert.deepEqual(
      pick(BROWSER_PROFILES, 'desktop,mobile-low').map((profile) => profile.id),
      ['desktop', 'mobile-low'],
    );
    assert.equal(pick(BROWSER_PROFILES, null), BROWSER_PROFILES);
    assert.throws(() => pick(BROWSER_PROFILES, 'tablet'), /Unknown environment\(s\): tablet\. Known: desktop, mobile-mid, mobile-low/);
  });
});

suite('cpu time', { skip: process.platform === 'linux' ? false : 'reads /proc' }, () => {
  test('a process that burns CPU is seen to have used it', async () => {
    const before = await treeCpuMs(process.pid);
    const until = performance.now() + 120;
    let spin = 0;
    while (performance.now() < until) spin += Math.sqrt(spin + 1);
    const after = await treeCpuMs(process.pid);
    assert.ok(after - before >= 60, `${after - before} ms of CPU for 120 ms of spinning`);
  });

  test('a process that is not there has no figure', async () => {
    assert.equal(await treeCpuMs(2 ** 22 + 1), null);
  });
});

suite('the compressing proxy', async () => {
  const seen = [];
  const origin = http.createServer((request, response) => {
    seen.push({
      url: request.url,
      method: request.method,
      host: request.headers.host,
      forwardedHost: request.headers['x-forwarded-host'],
      encoding: request.headers['accept-encoding'],
    });
    if (request.url === '/page') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': '5000' });
      response.end('a'.repeat(5000));
    } else if (request.url === '/image') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.alloc(300, 7));
    } else if (request.url === '/stream') {
      response.writeHead(200, { 'content-type': 'text/x-component' });
      response.write('first\n');
      setTimeout(() => response.end('second\n'), 150);
    } else if (request.url === '/echo') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ got: body }));
      });
    } else {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('no');
    }
  });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  // A free port for the proxy: the harness gives it a fixed one per target, which a test cannot assume is free.
  const free = await new Promise((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const proxy = await startEdge(`http://127.0.0.1:${origin.address().port}`, free);
  test.after(async () => {
    await proxy.stop();
    await new Promise((resolve) => origin.close(resolve));
  });

  /** A raw request, so nothing decompresses behind the test's back. */
  const raw = (path, { method = 'GET', body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(`${proxy.base}${path}`, { method, headers }, (response) => {
        const chunks = [];
        const arrivals = [];
        response.on('data', (chunk) => (chunks.push(chunk), arrivals.push(performance.now())));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), arrivals }));
      });
      request.on('error', reject);
      request.end(body);
    });

  test('text is gzipped for every target the same way, whatever the client offered', async () => {
    const res = await raw('/page', { headers: { 'accept-encoding': 'br, zstd' } });
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers['content-length'], undefined, 'the origin’s length no longer describes the body');
    assert.ok(res.body.length < 200, `5000 repeated bytes compress (${res.body.length})`);
    assert.equal(zlib.gunzipSync(res.body).toString(), 'a'.repeat(5000));
    assert.equal(seen.at(-1).encoding, 'identity', 'and the origin was asked for it uncompressed');
  });

  test('what does not compress is passed through as it was', async () => {
    const res = await raw('/image');
    assert.equal(res.headers['content-encoding'], undefined);
    assert.equal(res.body.length, 300);
  });

  test('a streamed response still arrives as it is produced', async () => {
    const res = await raw('/stream');
    assert.equal(zlib.gunzipSync(res.body).toString(), 'first\nsecond\n');
    assert.ok(res.arrivals.at(-1) - res.arrivals[0] >= 100, 'the first chunk was not held for the last');
  });

  test('the browser’s Host reaches the origin, so an Origin check against it passes', async () => {
    await raw('/page');
    assert.equal(seen.at(-1).host, `127.0.0.1:${free}`);
    assert.equal(seen.at(-1).forwardedHost, `127.0.0.1:${free}`);
  });

  test('a POST goes through with its body, and its status comes back', async () => {
    const res = await raw('/echo', { method: 'POST', body: 'payload', headers: { 'content-type': 'text/plain' } });
    assert.equal(res.status, 201);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(res.body).toString()), { got: 'payload' });
  });

  test('an error status is an error status', async () => {
    assert.equal((await raw('/nothing')).status, 404);
  });
});
