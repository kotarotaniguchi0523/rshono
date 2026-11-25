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

/** Counts requests for a document — a reload or a document load, and never a soft navigation's commit. */
function countDocumentRequests(page) {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) seen.count++;
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
  // The reload is on record, with its time: it stands for any chunk failure in the next half minute, and
  // for none after that. Nothing releases it early — see `chunk-recovery.ts` for why a working boot does not.
  const spent = Number(await page.evaluate((key) => sessionStorage.getItem(key), KEY));
  expect(Date.now() - spent).toBeLessThan(30_000);
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

test('once the runtime is up, a failed import nobody rendered reloads nothing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  const loads = countDocumentRequests(page);

  // Announced the way Vite announces one. Before hydration the preamble reloads on this alone (unit.test.mjs
  // drives that, with the page-being-left and back/forward-cache cases); after it, the event has no owner
  // until React reports its error from a render.
  await page.evaluate(() => {
    const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
      payload: new TypeError('Failed to fetch dynamically imported module'),
    });
    window.dispatchEvent(event);
  });
  await page.waitForTimeout(800);

  expect(loads.count).toBe(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBeNull();
});

/*
 * After the runtime is up. A chunk can fail to load for three different owners — the page on screen, a
 * navigation on its way in, and a payload nobody has navigated to yet — and only the first two are the
 * visitor's problem. Each is bounded on its own terms: what a reload did not fix, another will not.
 */
test.describe('a chunk that fails after hydration', () => {
  const PANEL = /assets\/lazy-late-panel-[^/]+\.js$/;
  const USER_LIST = /assets\/user-list-[^/]+\.js$/;
  const gone = (route) => route.fulfill({ status: 404, body: 'gone' });

  async function openLate(page, query = '') {
    await page.goto(`/lazy-late${query}`);
    await page.locator('[data-lazy-late-ready]').waitFor();
    await page.waitForLoadState('networkidle');
  }

  async function openHome(page) {
    await page.goto('/');
    await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  }

  test('on the page being looked at: one reload, after which the chunk is there', async ({ page }) => {
    await openLate(page);
    const loads = countDocumentLoads(page);
    let failures = 1;
    await page.route(PANEL, (route) => (failures-- > 0 ? gone(route) : route.fallback()));

    await page.locator('[data-lazy-late-open]').click();

    await expect.poll(() => loads.count).toBe(1);
    await page.locator('[data-lazy-late-ready]').waitFor();
    await page.locator('[data-lazy-late-open]').click();
    await expect(page.locator('[data-lazy-late-panel]')).toBeVisible();
    expect(loads.count).toBe(1);
  });

  test('and when the reload did not bring it back, there is no second one', async ({ page }) => {
    await openLate(page);
    const loads = countDocumentLoads(page);
    await page.route(PANEL, gone);

    await page.locator('[data-lazy-late-open]').click();
    await expect.poll(() => loads.count).toBe(1);
    await page.locator('[data-lazy-late-ready]').waitFor();
    await page.waitForLoadState('networkidle');

    // The same chunk, the same failure, in the document the reload produced.
    await page.locator('[data-lazy-late-open]').click();
    await expect(page.locator('[data-rsvhono-fatal]')).toBeVisible();
    await page.waitForTimeout(2500);
    expect(loads.count, 'the failure is shown, not retried').toBe(1);
  });

  test('inside the app’s own error boundary it still reloads once, then leaves the boundary’s fallback', async ({ page }) => {
    await openLate(page, '?bounded=1');
    const loads = countDocumentLoads(page);
    await page.route(PANEL, gone);

    await page.locator('[data-lazy-late-open]').click();
    await expect.poll(() => loads.count).toBe(1);
    await page.locator('[data-lazy-late-ready]').waitFor();
    await page.waitForLoadState('networkidle');

    await page.locator('[data-lazy-late-open]').click();
    await expect(page.locator('[data-lazy-late-caught]')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(loads.count).toBe(1);
    await expect(page.locator('[data-rsvhono-fatal]')).toHaveCount(0);
  });

  test('a later failure, long after the last reload, gets a reload of its own', async ({ page }) => {
    await openLate(page);
    const loads = countDocumentLoads(page);
    await page.route(PANEL, gone);
    await page.locator('[data-lazy-late-open]').click();
    await expect.poll(() => loads.count).toBe(1);
    await page.locator('[data-lazy-late-ready]').waitFor();
    await page.waitForLoadState('networkidle');

    // As if the reload above had happened ten minutes ago: another deploy, another missing file.
    await page.evaluate((key) => sessionStorage.setItem(key, String(Date.now() - 10 * 60_000)), KEY);
    await page.locator('[data-lazy-late-open]').click();
    await expect.poll(() => loads.count).toBe(2);
  });

  test('for a page fetched ahead: nothing happens to the page on screen', async ({ page }) => {
    await openHome(page);
    const loads = countDocumentRequests(page);
    const chunkAsked = page.waitForResponse(USER_LIST);
    await page.route(USER_LIST, gone);

    await page.evaluate(() => {
      const anchor = Object.assign(document.createElement('a'), { href: '/users' });
      anchor.dataset.prefetch = '';
      document.body.append(anchor);
      anchor.dispatchEvent(new PointerEvent('pointerenter'));
    });
    // The payload names the chunk and the browser asks for it; that request fails.
    await chunkAsked;
    await page.waitForTimeout(1500);

    expect(loads.count, 'a visitor who never clicks never learns the chunk was missing').toBe(0);
    await expect(page).toHaveURL('/');
    await expect(page.getByText('(hydrated ✓)')).toBeVisible();
    await expect(page.locator('[data-rsvhono-fatal]')).toHaveCount(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY), 'and no reload was spent on it').toBeNull();
  });

  test('for a navigation: one document load of where it was going, and no more', async ({ page }) => {
    await openHome(page);
    const loads = countDocumentRequests(page);
    await page.route(USER_LIST, gone);

    await page.evaluate(() => void navigation.navigate('/users').finished.catch(() => {}));

    await expect.poll(() => loads.count).toBe(1);
    await expect(page).toHaveURL('/users');
    await page.waitForTimeout(4000);
    expect(loads.count, 'the document that came back has the same hole, and is not reloaded for it').toBe(1);
    // The page cannot hydrate without the chunk, and says so, with a button — rather than trying again unasked.
    await expect(page.locator('[data-rsvhono-fatal]')).toBeVisible();
  });

  test('for a navigation already superseded: the page that won is left alone', async ({ page }) => {
    await openHome(page);
    const loads = countDocumentRequests(page);
    // Slow to fail, so the second navigation is under way before the first one's chunk gives up.
    await page.route(USER_LIST, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await gone(route).catch(() => {});
    });

    await page.evaluate(() => void navigation.navigate('/users').finished.catch(() => {}));
    await page.waitForTimeout(100);
    await page.evaluate(() => navigation.navigate('/boundary').finished);
    await expect(page).toHaveURL('/boundary');
    await page.waitForTimeout(2000);

    expect(loads.count).toBe(0);
    await expect(page).toHaveURL('/boundary');
    await expect(page.locator('[data-rsvhono-fatal]')).toHaveCount(0);
  });

  test('a build mismatch still reloads when a chunk reload was spent moments ago', async ({ page }) => {
    await openLate(page);
    const loads = countDocumentLoads(page);
    await page.route(PANEL, gone);
    await page.locator('[data-lazy-late-open]').click();
    await expect.poll(() => loads.count).toBe(1);
    await page.locator('[data-lazy-late-ready]').waitFor();
    await page.waitForLoadState('networkidle');

    // Now the server turns out to be another build. That is a different fact with its own count.
    await page.route('**/lazy-late', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({ status: 409, headers: { 'x-rsvhono-build': '0000000000000000', 'content-type': 'text/plain' }, body: 'another build' });
    });
    await page.locator('[data-lazy-late-call]').click();
    await expect.poll(() => loads.count).toBe(2);
    await page.locator('[data-lazy-late-ready]').waitFor();
  });
});
