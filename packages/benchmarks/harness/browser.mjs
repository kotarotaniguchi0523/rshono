/**
 * What the visitor's device pays, measured in a browser, under more than one device (`lib/environments.mjs`).
 *
 * `payload.mjs` counts the bytes a route commits the browser to. This runs them: each route is loaded in an
 * isolated browser context — nothing cached, as on a first visit — on an unthrottled desktop and on two
 * throttled phones, and the page is asked the questions a byte count cannot answer.
 *
 * - **TTFB, FCP, LCP** — when the response starts, when something is painted, when the largest thing is.
 * - **Total blocking time** — the part of every main-thread task over 50 ms, summed: time the page could not
 *   respond to input.
 * - **Script time** — main-thread time spent running JavaScript, from the browser's own accounting. The
 *   closest thing here to a device-independent cost of what was shipped.
 * - **Hydrated** — on `/interactive`, when the counter first answers a click. Not "the load event fired":
 *   the moment the page does what it looks like it does.
 * - **Click → paint, keystroke → paint** — once hydrated, how long an interaction takes to reach the screen.
 * - **Mutation round trip** — submit the form, wait for the server function's answer to be rendered.
 * - **Soft navigation** — click a link in the nav and wait for the next page's content: the time, the bytes
 *   and the requests, whatever protocol the framework speaks to get them. Whether the document survived the
 *   navigation is recorded too, since a framework that reloads has answered a different question.
 * - **JS heap** — after the page is idle and a forced collection.
 *
 * Bytes are what crossed the wire, gzipped by one proxy the harness puts in front of every target
 * (`lib/edge.mjs`) — not by the apps, which compress nothing, and not left to each server's defaults.
 *
 * Each figure is a distribution over the runs, not one load.
 */
// The functions handed to the page run in the browser, where these are globals.
/* global window, document, requestAnimationFrame, addEventListener, HTMLInputElement */
import { existsSync } from 'node:fs';
import { resolveTargets, flagValue, hasFlag } from './lib/targets.mjs';
import { indent, startServer, portFree } from './lib/proc.mjs';
import { BROWSER_PROFILES, pick } from './lib/environments.mjs';
import { startEdge } from './lib/edge.mjs';
import { describe, ms, bytes } from './lib/stats.mjs';
import { merge } from './lib/results.mjs';

const targets = resolveTargets();
const quick = hasFlag('quick');
const runs = Number(flagValue('runs', quick ? '3' : '7'));
const profiles = pick(BROWSER_PROFILES, flagValue('profile', null));
const PAGES = [
  { id: 'home', path: '/', ready: 'Server Components' },
  { id: 'ssr', path: '/ssr', ready: '100 users' },
  { id: 'interactive', path: '/interactive', ready: 'Sign up' },
];

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    return { skipped: '@playwright/test is not installed (pnpm install at the repository root)' };
  }
  try {
    return { browser: await chromium.launch() };
  } catch (error) {
    const system = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
    if (!system) return { skipped: `no Chromium to launch — ${String(error.message).split('\n')[0]} (npx playwright install chromium)` };
    return { browser: await chromium.launch({ executablePath: system, args: ['--no-sandbox'] }) };
  }
}

/** Runs in the page before any of its own script: the observers have to be there before what they observe. */
function instrument() {
  const seen = { fcp: null, lcp: null, tbt: 0, hydratedAt: null };
  window.__bench = seen;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') seen.fcp = entry.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) seen.lcp = entry.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) seen.tbt += Math.max(0, entry.duration - 50);
  }).observe({ type: 'longtask', buffered: true });

  // Hydration, observed from outside: keep pressing the counter until it counts. A click before React has
  // attached its handler does nothing, so the first press that lands is the moment the page became live.
  const probe = setInterval(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Increment');
    if (!button) return;
    const label = button.nextElementSibling;
    if (label && !/Clicked 0 times/.test(label.textContent)) {
      seen.hydratedAt = performance.now();
      clearInterval(probe);
      return;
    }
    button.click();
  }, 16);
  addEventListener('pagehide', () => clearInterval(probe));
}

/** One isolated visit. Returns the figures, or throws if the page never showed what the spec says it shows. */
async function visit(browser, profile, base, page) {
  const context = await browser.newContext({ viewport: profile.viewport });
  const tab = await context.newPage();
  const cdp = await context.newCDPSession(tab);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  if (profile.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network });

  const traffic = { bytes: 0, requests: 0, js: 0, types: new Map() };
  cdp.on('Network.responseReceived', ({ requestId, type }) => traffic.types.set(requestId, type));
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    traffic.bytes += encodedDataLength;
    traffic.requests += 1;
    if (traffic.types.get(requestId) === 'Script') traffic.js += encodedDataLength;
  });
  const snapshot = () => ({ bytes: traffic.bytes, requests: traffic.requests });

  await tab.addInitScript(instrument);
  try {
    await tab.goto(base + page.path, { waitUntil: 'load', timeout: 90_000 });
    await tab.getByText(page.ready, { exact: false }).first().waitFor({ timeout: 30_000 });
    await tab.waitForLoadState('networkidle', { timeout: 60_000 });
    if (page.id === 'interactive') await tab.waitForFunction(() => window.__bench.hydratedAt !== null, null, { timeout: 60_000 });
    // LCP is only final once the page is past its first input or has settled; give it a beat.
    await tab.waitForTimeout(150);

    const timing = await tab.evaluate(() => {
      const [nav] = performance.getEntriesByType('navigation');
      return { ...window.__bench, ttfb: nav.responseStart, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd };
    });
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    const loaded = snapshot();
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;

    const out = {
      ttfb: timing.ttfb,
      fcp: timing.fcp,
      lcp: timing.lcp,
      tbt: timing.tbt,
      load: timing.load,
      scriptMs: metrics.ScriptDuration * 1000,
      taskMs: metrics.TaskDuration * 1000,
      bytes: loaded.bytes,
      jsBytes: traffic.js,
      requests: loaded.requests,
      heapBytes: heap,
    };

    if (page.id === 'interactive') {
      out.hydrated = timing.hydratedAt;
      // An interaction, from the event to the frame that shows its result.
      const toPaint = (act) =>
        tab.evaluate(async (source) => {
          const started = performance.now();
          new Function(`return (${source})`)()();
          await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
          return performance.now() - started;
        }, act.toString());
      out.clickToPaint = await toPaint(() => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Increment').click());
      // Typing into the filter re-renders a list of a hundred rows down to the matches.
      out.keystrokeToPaint = await toPaint(() => {
        const input = document.querySelector('input:not([name])') ?? document.querySelector('input[type="search"], input[placeholder*="ilter" i]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ada');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // The mutation path: the server function's round trip, to the rendered answer.
      const before = snapshot();
      await tab.getByLabel('Name').fill('Grace Hopper');
      await tab.getByLabel('Email').fill('grace@example.com');
      const started = Date.now();
      await tab.getByRole('button', { name: 'Submit' }).click();
      await tab.getByText(/Created user #/).waitFor({ timeout: 30_000 });
      out.mutation = Date.now() - started;
      await tab.waitForTimeout(100);
      out.mutationBytes = snapshot().bytes - before.bytes;
    }

    if (page.id === 'home') {
      // A soft navigation, judged by what the visitor sees: click, and wait for the next page's content.
      await tab.evaluate(() => {
        window.__sameDocument = true;
      });
      const before = snapshot();
      const started = Date.now();
      await tab.locator('nav a[href="/ssr"]').click();
      await tab.getByText('100 users', { exact: false }).first().waitFor({ timeout: 60_000 });
      out.navigation = Date.now() - started;
      await tab.waitForLoadState('networkidle', { timeout: 60_000 });
      const after = snapshot();
      out.navigationBytes = after.bytes - before.bytes;
      out.navigationRequests = after.requests - before.requests;
      out.navigationKeptDocument = await tab.evaluate(() => window.__sameDocument === true);
    }
    return out;
  } finally {
    await context.close();
  }
}

const launched = await launch();
if (launched.skipped) {
  console.log(`browser stage skipped: ${launched.skipped}`);
  await merge('browser', { skipped: launched.skipped, profiles: {} });
  process.exit(0);
}
const { browser } = launched;

for (const target of targets) {
  if (!(await portFree(target.port))) {
    console.error(`✗ port ${target.port} is already answering — something is still running from a previous run.`);
    await browser.close();
    process.exit(1);
  }
}

const out = { settings: { runs, chromium: browser.version(), wire: 'gzip level 6, applied by the harness to every target' }, profiles: {} };
for (const profile of profiles) out.profiles[profile.id] = { label: profile.label, cpu: profile.cpu, network: profile.network, targets: {} };

// One server at a time, every profile against it: the server is not what differs between profiles.
for (const target of targets) {
  console.log(`\n=== ${target.label} ===`);
  let server;
  try {
    server = await startServer(target);
  } catch (error) {
    for (const profile of profiles) out.profiles[profile.id].targets[target.id] = { label: target.label, error: error.message };
    console.log(indent(error.message));
    continue;
  }
  // Every target behind the same compressing proxy (`lib/edge.mjs`): the bytes on the wire are gzip, applied
  // by the harness, for all three.
  const edge = await startEdge(server.base, target.port + 1000);
  try {
    for (const profile of profiles) {
      const pages = {};
      for (const page of PAGES) {
        const collected = {};
        let failure = null;
        for (let run = 0; run < runs; run++) {
          try {
            const figures = await visit(browser, profile, edge.base, page);
            for (const [key, value] of Object.entries(figures)) (collected[key] ??= []).push(value);
          } catch (error) {
            failure = String(error.message).split('\n')[0];
            break;
          }
        }
        if (failure) {
          pages[page.id] = { error: failure };
          console.log(`  ${profile.id.padEnd(11)} ${page.path.padEnd(13)} ⚠ ${failure}`);
          continue;
        }
        const summarized = {};
        for (const [key, values] of Object.entries(collected)) {
          if (typeof values[0] === 'boolean') summarized[key] = values.every(Boolean);
          else summarized[key] = { ...describe(values.filter((value) => value !== null)), samples: values };
        }
        pages[page.id] = summarized;
        const at = (key) => (summarized[key] ? ms(summarized[key].median) : '—');
        console.log(
          `  ${profile.id.padEnd(11)} ${page.path.padEnd(13)} fcp ${at('fcp').padStart(7)}  lcp ${at('lcp').padStart(7)}  tbt ${at('tbt').padStart(7)}` +
            `  script ${at('scriptMs').padStart(7)}  ${bytes(Math.round(summarized.bytes.median)).padStart(9)}` +
            (page.id === 'interactive' ? `  hydrated ${at('hydrated')}  mutation ${at('mutation')}` : '') +
            (page.id === 'home' ? `  → /ssr ${at('navigation')}${summarized.navigationKeptDocument ? '' : ' (reloaded)'}` : ''),
        );
      }
      out.profiles[profile.id].targets[target.id] = { label: target.label, pages };
    }
  } finally {
    await edge.stop();
    await server.stop();
  }
}
await browser.close();

await merge('browser', out);
console.log('\nwrote results/latest.json → sections.browser');
