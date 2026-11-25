// Numbers, not assertions: what a build, a dev server and a production server cost on this machine.
//
//   node test/experiments/measure.mjs            (from packages/core, after `npm run build`)
//
// Not part of `npm test` — a time is not something a suite should pass or fail on. The output is what
// docs/upstream-audit.md quotes, and re-running this is how those rows are refreshed.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { FIXTURES_DIR, startApp, stopServer, TESTBED_DIR, TESTBED_DIST } from '../helpers.mjs';

const CLI = join(TESTBED_DIR, '..', '..', 'packages', 'core', 'bin', 'rsvhono.mjs');
const HMR_APP = join(FIXTURES_DIR, 'hmr-app');
const ms = (from) => Math.round(performance.now() - from);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length * p) / 100))];
const mb = (kb) => Math.round(kb / 102.4) / 10;

/** Resident and peak-resident memory of a process, in MB. Linux only; elsewhere the rows are left out. */
function memory(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const read = (key) => mb(Number(new RegExp(`${key}:\\s+(\\d+) kB`).exec(status)[1]));
    return { rss: read('VmRSS'), peak: read('VmHWM') };
  } catch {
    return undefined;
  }
}

function build() {
  const from = performance.now();
  const result = spawnSync(process.execPath, [CLI, 'build'], { cwd: TESTBED_DIR, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return ms(from);
}

function bundleSizes() {
  const sizes = (dir, extension) => {
    let raw = 0;
    let gzip = 0;
    for (const file of readdirSync(dir, { recursive: true })) {
      const path = join(dir, file);
      if (!extension.test(file) || !statSync(path).isFile()) continue;
      const source = readFileSync(path);
      raw += source.length;
      gzip += gzipSync(source).length;
    }
    return { kB: Math.round(raw / 100) / 10, gzipKB: Math.round(gzip / 100) / 10 };
  };
  return {
    browserJs: sizes(join(TESTBED_DIST, 'static'), /\.js$/),
    browserCss: sizes(join(TESTBED_DIST, 'static'), /\.css$/),
    serverJs: sizes(join(TESTBED_DIST, 'server'), /\.m?js$/),
  };
}

async function timeRequests(url, count, concurrency = 1, headers = undefined) {
  const times = [];
  let next = 0;
  const worker = async () => {
    while (next++ < count) {
      const from = performance.now();
      await (await fetch(url, { headers })).arrayBuffer();
      times.push(performance.now() - from);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { p50: Math.round(percentile(times, 50) * 10) / 10, p95: Math.round(percentile(times, 95) * 10) / 10 };
}

async function launchBrowser() {
  try {
    const { chromium } = await import('@playwright/test');
    const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
    try {
      return await chromium.launch();
    } catch (error) {
      if (!systemChrome) throw error;
      return await chromium.launch({ executablePath: systemChrome, args: ['--no-sandbox'] });
    }
  } catch {
    return null;
  }
}

const results = {};

// ── Build ───────────────────────────────────────────────────────────────────────────────────────────────
results.buildMs = median([build(), build(), build()]);
results.bundles = bundleSizes();

// ── Production server ───────────────────────────────────────────────────────────────────────────────────
{
  const from = performance.now();
  const { child, base } = await startApp(TESTBED_DIR, 'start');
  results.start = { readyMs: ms(from), idle: memory(child.pid) };
  try {
    await timeRequests(`${base}/`, 20); // warm
    results.start.document = await timeRequests(`${base}/users`, 200);
    results.start.payload = await timeRequests(`${base}/users`, 200, 1, { rsc: '1' });
    results.start.prerendered = await timeRequests(`${base}/docs/getting-started`, 200);
    results.start.afterSequential = memory(child.pid);
    // Streaming under load: fifty responses held open at once, each suspended for two seconds.
    const from2 = performance.now();
    results.start.streaming50 = { ...(await timeRequests(`${base}/slow-stream`, 50, 50)), wallMs: ms(from2), memory: memory(child.pid) };
    // And whether memory levels off: resident size after each of four batches of 5000 requests, half of
    // them documents and half payloads. A leak climbs; a heap that has found its size does not.
    results.start.rssAfterBatchesOf5000 = [];
    for (let batch = 0; batch < 4; batch++) {
      await timeRequests(`${base}/users`, 2500, 20);
      await timeRequests(`${base}/users`, 2500, 20, { rsc: '1' });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      results.start.rssAfterBatchesOf5000.push(memory(child.pid)?.rss);
    }
  } finally {
    await stopServer(child);
  }
}

// ── Browser, against the production build ───────────────────────────────────────────────────────────────
const browser = await launchBrowser();
if (browser) {
  const { child, base } = await startApp(TESTBED_DIR, 'start');
  try {
    const runs = [];
    for (let n = 0; n < 5; n++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let jsBytes = 0;
      let requests = 0;
      page.on('response', async (response) => {
        requests++;
        if (response.url().endsWith('.js')) jsBytes += Number(response.headers()['content-length'] ?? 0);
      });
      await page.goto(`${base}/`, { waitUntil: 'load' });
      // Hydrated when the counter answers a click.
      const hydrated = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const tick = () => {
              const button = document.querySelector('button');
              const before = button?.textContent;
              button?.click();
              requestAnimationFrame(() => (button && button.textContent !== before ? resolve(performance.now()) : setTimeout(tick, 5)));
            };
            tick();
          }),
      );
      const timing = await page.evaluate(() => {
        const [entry] = performance.getEntriesByType('navigation');
        const paint = performance.getEntriesByName('first-contentful-paint')[0];
        return { ttfb: entry.responseStart, domContentLoaded: entry.domContentLoadedEventEnd, load: entry.loadEventEnd, fcp: paint?.startTime };
      });
      // A soft navigation, from click to the new heading being there.
      const softFrom = await page.evaluate(() => performance.now());
      await page.evaluate(() => navigation.navigate('/users').finished);
      const soft = (await page.evaluate(() => performance.now())) - softFrom;
      runs.push({ ...timing, hydrated, soft, jsBytes, requests });
      await context.close();
    }
    const pick = (key) => Math.round(median(runs.map((run) => run[key] ?? 0)));
    results.firstLoad = {
      ttfbMs: pick('ttfb'),
      fcpMs: pick('fcp'),
      domContentLoadedMs: pick('domContentLoaded'),
      hydratedMs: pick('hydrated'),
      softNavigationMs: pick('soft'),
      jsTransferredKB: Math.round(pick('jsBytes') / 100) / 10,
      requests: pick('requests'),
    };
  } finally {
    await stopServer(child);
  }
}

// ── Dev server ──────────────────────────────────────────────────────────────────────────────────────────
{
  const from = performance.now();
  const { child, base } = await startApp(HMR_APP, 'dev', { env: { PUBLIC_FIXTURE: 'shown' } });
  results.dev = { readyMs: ms(from) };
  try {
    const first = performance.now();
    await (await fetch(`${base}/`)).text();
    results.dev.firstRequestMs = ms(first);
    results.dev.warm = await timeRequests(`${base}/`, 30);
    results.dev.memory = memory(child.pid);

    if (browser) {
      const homeFile = join(HMR_APP, 'src', 'pages', 'home.tsx');
      const counterFile = join(HMR_APP, 'src', 'components', 'counter.tsx');
      const cssFile = join(HMR_APP, 'src', 'pages', 'home.css');
      const sources = Object.fromEntries([homeFile, counterFile, cssFile].map((file) => [file, readFileSync(file, 'utf8')]));
      const page = await browser.newPage();
      page.on('console', (message) => process.env.MEASURE_DEBUG && console.error('console:', message.text().slice(0, 160)));
      try {
        await page.goto(`${base}/`);
        await page.waitForFunction(() => {
          const button = document.querySelector('[data-testid=count]');
          button.click();
          return /[1-9]/.test(button.textContent);
        });
        /** Writes one edit and its revert `rounds` times, timing write → visible in the page. */
        const hmr = async (file, edit, seen, unseen, rounds = 5) => {
          const times = [];
          for (let n = 0; n < rounds; n++) {
            const from3 = performance.now();
            writeFileSync(file, edit(sources[file]));
            await page.waitForFunction(seen, null, { timeout: 20_000, polling: 'raf' });
            times.push(performance.now() - from3);
            // A second write to the same file tens of milliseconds after the first was seen to be dropped by
            // the dev server here (a client module's revert never arrived). Not chased: nobody saves that fast.
            await new Promise((resolve) => setTimeout(resolve, 400));
            writeFileSync(file, sources[file]);
            await page.waitForFunction(unseen, null, { timeout: 20_000, polling: 'raf' });
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          return Math.round(median(times));
        };
        results.dev.hmr = {
          serverComponentMs: await hmr(
            homeFile,
            (source) => source.replace('Vite app\n', 'Vite app, edited\n'),
            () => document.querySelector('h1').textContent.includes('edited'),
            () => !document.querySelector('h1').textContent.includes('edited'),
          ),
          clientComponentMs: await hmr(
            counterFile,
            (source) => source.replace('count: {count}', 'clicks: {count}'),
            () => document.querySelector('[data-testid=count]').textContent.startsWith('clicks'),
            () => document.querySelector('[data-testid=count]').textContent.startsWith('count'),
          ),
          stylesheetMs: await hmr(
            cssFile,
            (source) => source.replace('rgb(0, 128, 0)', 'rgb(0, 0, 255)'),
            () => getComputedStyle(document.querySelector('h1')).color === 'rgb(0, 0, 255)',
            () => getComputedStyle(document.querySelector('h1')).color === 'rgb(0, 128, 0)',
          ),
        };
      } finally {
        for (const [file, source] of Object.entries(sources)) writeFileSync(file, source);
        await page.close();
      }
    }
  } finally {
    await stopServer(child);
  }
}

await browser?.close();
console.log(JSON.stringify(results, null, 2));
