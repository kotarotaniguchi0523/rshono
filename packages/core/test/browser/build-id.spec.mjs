import { expect, test } from '@playwright/test';
import { isPayloadGet } from './payload-holds.mjs';

/*
 * A page from one build and a server from another. The browser tab outlives a deploy; from then on what the
 * server sends names chunks and functions this page does not have. Simulated here by rewriting the build id
 * on the wire — the server and the page are the same build, and one response is made to say otherwise.
 */

const OTHER_BUILD = '0000000000000000';

/** Counts full document loads of the tab from here on. */
function countDocumentLoads(page) {
  const seen = { count: 0 };
  page.on('load', () => seen.count++);
  return seen;
}

async function open(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test('a payload from this build is decoded as before', async ({ page }) => {
  await open(page, '/');
  const loads = countDocumentLoads(page);
  await page.evaluate(() => navigation.navigate('/users').finished);
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  expect(loads.count).toBe(0);
});

test('a payload from another build is not decoded: the navigation ends in a document load of its destination', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await open(page, '/');
  const loads = countDocumentLoads(page);
  await page.route('**/users', async (route) => {
    if (!isPayloadGet(route.request(), '/users')) return route.fallback();
    const response = await route.fetch();
    // The body is a perfectly good payload. It must not matter: the header is read first.
    await route.fulfill({ response, headers: { ...response.headers(), 'x-rsvhono-build': OTHER_BUILD } });
  });

  await page.evaluate(() => void navigation.navigate('/users').finished.catch(() => {}));

  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await expect(page).toHaveURL('/users');
  await expect.poll(() => loads.count).toBe(1);
  await expect(page.locator('[data-rsvhono-fatal]')).toHaveCount(0);
  expect(errors.filter((text) => /chunk|module|Minified React/i.test(text))).toEqual([]);
});

test('a late payload from another build, for a navigation already superseded, reloads nothing', async ({ page }) => {
  await open(page, '/');
  const loads = countDocumentLoads(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let asked;
  const onTheWire = new Promise((resolve) => {
    asked = resolve;
  });
  await page.route('**/about', async (route) => {
    if (!isPayloadGet(route.request(), '/about')) return route.fallback();
    const response = await route.fetch();
    asked();
    await held;
    await route.fulfill({ response, headers: { ...response.headers(), 'x-rsvhono-build': OTHER_BUILD } }).catch(() => {});
  });
  try {
    await page.evaluate(() => void navigation.navigate('/about').finished.catch(() => {}));
    await onTheWire;
    await page.evaluate(() => navigation.navigate('/users').finished);
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();

    release();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL('/users');
    expect(loads.count).toBe(0);
  } finally {
    release();
  }
});

test('a function call refused by another build reaches its caller, is not sent again, and reloads the page once', async ({ page }) => {
  await page.goto('/action-race');
  await page.waitForFunction(() => document.documentElement.dataset.actionRaceReady === 'true');
  let posts = 0;
  await page.route('**/action-race', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts++;
    // What the server answers a call from another build with: a 409, and its own id.
    await route.fulfill({ status: 409, contentType: 'text/plain', headers: { 'x-rsvhono-build': OTHER_BUILD }, body: 'Conflict' });
  });
  const loads = countDocumentLoads(page);
  const failed = (label) =>
    page.evaluate(
      (name) =>
        window.__race(name, 0).then(
          () => 'resolved',
          (error) => ({ name: error.name, code: error.code }),
        ),
      label,
    );

  // The caller is told, in a way it can tell apart from an ordinary failure.
  expect(await failed('first')).toEqual({ name: 'BuildMismatchError', code: 'RSVHONO_BUILD_MISMATCH' });
  // The page is replaced with the server's own — once the caller has been told.
  await expect.poll(() => loads.count).toBe(1);
  await page.waitForFunction(() => document.documentElement.dataset.actionRaceReady === 'true');
  // The mutation was not sent again: not before the reload, and not by the page that came back.
  expect(posts).toBe(1);

  // Still the old page — a cache in between, say. A second reload would get the same thing, so there is none.
  expect(await failed('second')).toEqual({ name: 'BuildMismatchError', code: 'RSVHONO_BUILD_MISMATCH' });
  await page.waitForTimeout(500);
  expect(loads.count).toBe(1);
  expect(posts).toBe(2);
});

test('alternating between two builds never loops: every recovery is one document load the visitor asked for', async ({ page }) => {
  await open(page, '/');
  const loads = countDocumentLoads(page);
  let flip = false;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET' || request.headers()['rsc'] !== '1') return route.fallback();
    const response = await route.fetch();
    flip = !flip;
    // Every other payload comes from "the other server".
    await route.fulfill({ response, headers: flip ? { ...response.headers(), 'x-rsvhono-build': OTHER_BUILD } : response.headers() });
  });

  for (const [path, heading] of [
    ['/users', 'Users'],
    ['/boundary', 'AsyncBoundary'],
    ['/users', 'Users'],
    ['/boundary', 'AsyncBoundary'],
  ]) {
    await page.evaluate((to) => void navigation.navigate(to).finished.catch(() => {}), path);
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(heading);
    await page.waitForLoadState('load');
  }
  await page.waitForTimeout(500);
  // Two of the four navigations met the other build; each became one document load, and nothing reloaded on its own.
  expect(loads.count).toBe(2);
});
