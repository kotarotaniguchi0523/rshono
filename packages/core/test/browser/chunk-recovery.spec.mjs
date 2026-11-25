import { expect, test } from '@playwright/test';

/*
 * A document whose scripts will not load: the entry chunk, or a chunk a client component lives in. After a
 * deploy the files a page names by hash are gone. The inline preamble (`runtime/chunk-recovery.ts`) reloads
 * the document — once — so the server can hand out a page that names the files it has.
 */

const ENTRY = /\/_static\/assets\/index-[^/]+\.js$/;
const KEY = 'rsvhono:chunk-reload';

/**
 * Counts the documents the tab commits from here on. Not `load` events: a reload that starts while the
 * document is still streaming replaces it before it ever fires one.
 */
function countDocumentLoads(page) {
  const seen = { count: 0 };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) seen.count++;
  });
  return seen;
}

test('a boot that works leaves nothing spent', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBeNull();
});

test('an entry chunk that fails to load reloads the document once, and the reload hydrates', async ({ page }) => {
  const loads = countDocumentLoads(page);
  let failures = 1;
  await page.route(ENTRY, (route) => (failures-- > 0 ? route.abort() : route.fallback()));

  await page.goto('/');

  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  expect(loads.count).toBe(2);
  // Released by the boot that worked, so the next failure — another deploy — gets a reload of its own.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBeNull();
});

test('an entry chunk that still fails after the reload is not reloaded again', async ({ page }) => {
  const loads = countDocumentLoads(page);
  await page.route(ENTRY, (route) => route.fulfill({ status: 404, body: 'gone' }));

  await page.goto('/');
  await page.waitForTimeout(1500);

  expect(loads.count).toBe(2);
  // What the server rendered is still a page: readable, with links that are the browser's.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText('(hydrated ✓)')).toHaveCount(0);
});

test('a client component’s chunk that fails to load reloads the document once, and only once', async ({ page }) => {
  const loads = countDocumentLoads(page);
  // A 404, which is what a chunk a deploy removed answers with.
  await page.route(/reachability-lazy-client-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: 'gone' }));

  await page.goto('/reachability');
  await page.waitForTimeout(2000);

  // One reload, for the import Vite reported — and the same failure in the document that came back is not
  // answered with another. (After a real deploy that document names a different file. Here it names the same
  // one, so what this can show is the bound, not the cure: the runtime's own recovery, which also wants to
  // reload when a render dies, stands down while the preamble's reload is spent.)
  expect(loads.count).toBe(2);
  await expect(page.locator('[data-rsvhono-fatal]')).toBeVisible();
});

test('with no usable sessionStorage nothing can be counted, so nothing is reloaded', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  const loads = countDocumentLoads(page);
  await page.route(ENTRY, (route) => route.abort());

  await page.goto('/');
  await page.waitForTimeout(1500);

  expect(loads.count).toBe(1);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('an import that fails because the page is being left is not a missing chunk', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  const loads = countDocumentLoads(page);

  // Leaving, then a preload failure announced the way Vite announces one.
  const reloaded = await page.evaluate((key) => {
    window.dispatchEvent(new Event('pagehide'));
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    return sessionStorage.getItem(key);
  }, KEY);
  expect(reloaded).toBeNull();

  // Restored from the back/forward cache, the watch is back.
  const restored = await page.evaluate((key) => {
    window.dispatchEvent(new Event('pageshow'));
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    return sessionStorage.getItem(key);
  }, KEY);
  expect(restored).toBe('1');
  await expect.poll(() => loads.count).toBe(1);
});
