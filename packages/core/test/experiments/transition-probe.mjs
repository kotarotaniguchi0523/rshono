/**
 * An observation, not a test: what React does with a client component's own state changes while a navigation
 * is pending, and with a navigation while one of those is pending.
 *
 *   node test/experiments/transition-probe.mjs http://127.0.0.1:3000 [chrome path]
 *
 * It drives `/transition-probe`, which is written against React alone, so the same page under another
 * framework answers the same questions — that is how a React behaviour is told from one of ours. Results and
 * what they were compared with: `docs/react-transitions.md`.
 */
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:3000', executablePath] = process.argv.slice(2);
const PATH = '/transition-probe';
/** How long the slow page stays suspended, and so the window a probe has to commit inside. */
const SLOW_MS = 3000;
/** How long a probe is kept pending when it is the navigation that is being timed. */
const HELD_MS = 2500;

const browser = await chromium.launch({ executablePath, args: executablePath ? ['--no-sandbox'] : [] });

async function open() {
  const page = await browser.newPage();
  await page.goto(base + PATH);
  await page.locator('[data-probe-panel]').waitFor();
  // Hydrated when a click is answered: the plain transition is the cheapest thing to ask.
  await page.waitForFunction(() => {
    document.querySelector('[data-probe-do="sync"]').click();
    return document.querySelector('[data-probe="sync"]').textContent !== '0';
  });
  return page;
}

const read = (page, name) => page.locator(`[data-probe="${name}"]`).first().textContent();
const onSlowPage = (page) =>
  page
    .locator('[data-probe-page="slow"]')
    .count()
    .then((n) => n > 0);

/** Milliseconds until `predicate` holds, or `null` if it does not within `limit`. */
async function timeUntil(page, predicate, arg, limit) {
  const started = Date.now();
  try {
    await page.waitForFunction(predicate, arg, { timeout: limit, polling: 20 });
    return Date.now() - started;
  } catch {
    return null;
  }
}

/** Does `probe` commit while a navigation is suspended inside React? */
async function probeDuringNavigation(probe) {
  const page = await open();
  const before = await read(page, probe);
  await page.locator('[data-probe-go="slow"]').click();
  // Long enough for the payload's root to arrive and the transition to start; far short of SLOW_MS.
  await page.waitForTimeout(500);
  const navigationPending = !(await onSlowPage(page));
  // Whether the URL has moved while the page has not: the payload is in hand and React is what is waiting.
  const urlAtProbe = new URL(page.url()).search;
  await page.locator(`[data-probe-do="${probe}"]`).click();
  const committedAfter = await timeUntil(
    page,
    ([name, was]) => {
      const text = document.querySelector(`[data-probe="${name}"]`)?.textContent;
      return text !== was && text !== '…' && !document.querySelector('[data-probe-page="slow"]');
    },
    [probe, before],
    SLOW_MS - 1000,
  );
  await page
    .locator('[data-probe-page="slow"]')
    .waitFor({ timeout: SLOW_MS + 4000 })
    .catch(() => {});
  const result = {
    navigationPending,
    urlAtProbe,
    committedWhileNavigationPending: committedAfter !== null,
    ms: committedAfter,
    navigationCommitted: await onSlowPage(page),
    valueAfterNavigation: await read(page, probe).catch(() => 'gone'),
    valueBefore: before,
  };
  await page.close();
  return result;
}

/** Does a navigation commit while `probe` is pending? */
async function navigationDuringProbe(probe) {
  const page = await open();
  await page.evaluate((ms) => {
    document.querySelector('[data-probe-do="async"]').dataset.ms = String(ms);
    document.querySelector('[data-probe-action-ms]').value = String(ms);
  }, HELD_MS);
  await page.locator(`[data-probe-do="${probe}"]`).click();
  await page.waitForTimeout(200);
  const probePending = (await read(page, `${probe}-pending`)) === 'true';
  await page.locator('[data-probe-go="fast"]').click();
  const committedAfter = await timeUntil(page, () => document.querySelector('[data-probe-visit*="visit=fast"]') !== null, undefined, HELD_MS + 4000);
  const result = {
    probePending,
    navigationCommittedWhileProbePending: committedAfter !== null && committedAfter < HELD_MS - 400,
    ms: committedAfter,
  };
  await page.close();
  return result;
}

const results = { base, reactNavigationPendingMs: SLOW_MS, probeHeldMs: HELD_MS, probeDuringNavigation: {}, navigationDuringProbe: {} };
for (const probe of ['sync', 'async', 'suspense', 'action']) results.probeDuringNavigation[probe] = await probeDuringNavigation(probe);
for (const probe of ['async', 'action']) results.navigationDuringProbe[probe] = await navigationDuringProbe(probe);
await browser.close();
console.log(JSON.stringify(results, null, 2));
