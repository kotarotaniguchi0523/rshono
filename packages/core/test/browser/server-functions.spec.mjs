import { expect, test } from '@playwright/test';
import { startTestbed, stopServer } from '../helpers.mjs';
import { isPayloadGet, unique } from './payload-holds.mjs';

/*
 * What a server function's caller gets back, apart from what happens to the screen — and the reply that
 * carries no page at all. The second half runs against a server of its own, started with
 * `setServerFunctionRefresh('explicit')`; the build is the same one.
 */

async function openRace(page, url = '/action-race') {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.actionRaceReady === 'true');
}

const entry = (page, label) => page.locator(`[data-race-entry="${label}"]`);

/** Counts the payload fetches for `pathname` from here on: navigations and re-reads, not function calls. */
function countPayloadGets(page, pathname) {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (isPayloadGet(request, pathname)) seen.count++;
  });
  return seen;
}

/** The like button: an optimistic count at once, settled by nothing but what the function returned. */
async function likeOnce(page) {
  const button = page.locator('[data-like]');
  const settledBefore = Number(await button.getAttribute('data-settled'));
  await button.click();
  // Optimistic: the count on the face moves while the settled one has not.
  await expect(button).toHaveText(`Like (${settledBefore + 1})`);
  expect(Number(await button.getAttribute('data-settled'))).toBe(settledBefore);
  // Settled: whatever total the server returned, and the face agrees with it.
  await expect(button).not.toHaveAttribute('data-settled', String(settledBefore));
  const settled = await button.getAttribute('data-settled');
  await expect(button).toHaveText(`Like (${settled})`);
}

test.describe('the caller’s result, whatever the page does next', () => {
  test('an action that succeeded keeps its result when the page it re-renders redirects', async ({ page }) => {
    const label = unique('then-redirect');
    await openRace(page, `/action-race?after=${label}&then=redirect`);

    // The function applies the label and returns it. Rendered again, the page sees the label and redirects.
    expect(await page.evaluate((name) => window.__race(name, 0), label)).toBe(label);

    await expect(page).toHaveURL('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  });

  test('an action that succeeded keeps its result when the page it re-renders calls notFound()', async ({ page }) => {
    const label = unique('then-notfound');
    await openRace(page, `/action-race?after=${label}&then=notfound`);

    expect(await page.evaluate((name) => window.__race(name, 0), label)).toBe(label);

    await expect(page.getByRole('heading', { level: 1, name: '404 — nothing here' })).toBeVisible();
  });

  test('an optimistic update shows at once and settles to what the function returned', async ({ page }) => {
    await openRace(page);
    await likeOnce(page);
  });

  test('a return value that is not all ready yet arrives in both halves', async ({ page }) => {
    await openRace(page);
    expect(await page.evaluate(() => window.__streamed('value'))).toEqual({ now: 'value', later: 'value-later' });
  });
});

/*
 * What a function can return: anything flight carries. The same in a reply with a page and in one without,
 * so each case runs against both servers.
 */
for (const mode of ['auto', 'explicit']) {
  test.describe(`return values, with ${mode === 'auto' ? 'the page in the reply' : 'no page in the reply'}`, () => {
    let server;
    test.beforeAll(async () => {
      if (mode === 'explicit') server = await startTestbed('start', { env: { TESTBED_ACTION_REFRESH: 'explicit' } });
    });
    test.afterAll(async () => {
      if (server) await stopServer(server.child);
    });
    const at = (path) => (server ? `${server.base}${path}` : path);

    test('a promise inside a promise inside a promise', async ({ page }) => {
      await openRace(page, at('/action-race'));
      expect(await page.evaluate(() => window.__returns.nested('n'))).toBe('n-deep');
    });

    test('an async iterable, value by value', async ({ page }) => {
      await openRace(page, at('/action-race'));
      expect(await page.evaluate((label) => window.__returns.ticking(label, 5, 30), unique('ticks'))).toEqual([1, 2, 3, 4, 5]);
    });

    test('a value that fails after the reply began rejects where it is awaited, and the rest still arrives', async ({ page }) => {
      await openRace(page, at('/action-race'));
      const result = await page.evaluate(() => window.__returns.failsLate('half'));
      expect(result.now).toBe('half');
      expect(result.later).toMatch(/^rejected: /);
    });

    test('what cannot be serialized comes back as the caller’s own object', async ({ page }) => {
      await openRace(page, at('/action-race'));
      expect(await page.evaluate(() => window.__returns.handBack())).toEqual({ sameFunction: true, sameInstance: true });
    });

    test('navigating away mid-stream takes the screen, not the caller’s values', async ({ page }) => {
      await openRace(page, at('/action-race'));
      await page.evaluate((label) => {
        window.__kept = window.__returns.ticking(label, 8, 80);
      }, unique('kept'));
      // A couple of values in, the visitor leaves the page that made the call.
      await page.waitForTimeout(200);
      await page.evaluate(() => navigation.navigate('/users').finished);
      await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
      // The navigation owns the screen. The caller is still owed everything the function returns.
      expect(await page.evaluate(() => window.__kept)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      await expect(page).toHaveURL(at('/users'));
    });
  });
}

test.describe("setServerFunctionRefresh('explicit')", () => {
  let server;
  test.beforeAll(async () => {
    server = await startTestbed('start', { env: { TESTBED_ACTION_REFRESH: 'explicit' } });
  });
  test.afterAll(async () => {
    if (server) await stopServer(server.child);
  });
  const at = (path) => `${server.base}${path}`;

  test('a function that does not ask for the page changes nothing on screen and re-reads nothing', async ({ page }) => {
    await openRace(page, at('/action-race'));
    const renders = await page.locator('[data-race-renders]').textContent();
    const rereads = countPayloadGets(page, '/action-race');
    const label = unique('result-only');

    expect(await page.evaluate((name) => window.__race(name, 0), label)).toBe(label);
    // Two at once as well: with pages in the replies this ends in a re-read, because neither page can be
    // trusted to be the newer. With no page in either there is nothing to distrust.
    const pair = [unique('pair-slow'), unique('pair-fast')];
    expect(await page.evaluate(([slow, fast]) => Promise.all([window.__race(slow, 300), window.__race(fast, 0)]), pair)).toEqual(pair);

    await page.waitForTimeout(400);
    await expect(entry(page, label)).toHaveCount(0);
    await expect(page.locator('[data-race-renders]')).toHaveText(renders);
    expect(rereads.count).toBe(0);
  });

  test('requestRefresh() is what puts the page back in the reply', async ({ page }) => {
    await openRace(page, at('/action-race'));
    const label = unique('refreshed');

    expect(await page.evaluate((name) => window.__raceAndRefresh(name), label)).toBe(label);

    await expect(entry(page, label)).toBeVisible();
  });

  test('useActionState gets its state from the reply alone', async ({ page }) => {
    await page.goto(at('/transition-probe'));
    await page.locator('[data-probe-panel]').waitFor();
    await page.waitForLoadState('networkidle');
    const state = page.locator('[data-probe="action"]');
    const before = Number(await state.textContent());

    await page.locator('[data-probe-do="action"]').click();

    await expect(page.locator('[data-probe="action-pending"]')).toHaveText('true');
    await expect(state).toHaveText(String(before + 1));
    await expect(page.locator('[data-probe="action-pending"]')).toHaveText('false');
  });

  test('an optimistic update settles from the reply alone', async ({ page }) => {
    await openRace(page, at('/action-race'));
    await likeOnce(page);
  });

  test('a streamed return value streams in a reply that carries no page', async ({ page }) => {
    await openRace(page, at('/action-race'));
    expect(await page.evaluate(() => window.__streamed('value'))).toEqual({ now: 'value', later: 'value-later' });
  });
  /*
   * What was fetched ahead of a navigation is a rendering from before the function ran. A reply that carries
   * no page says nothing about the screen — and that is all it says: it is still a mutation, and a payload
   * fetched before it is still stale. Throwing those away is a separate matter from re-rendering the page.
   */
  const prefetchLink = (page, href) =>
    page.evaluate((to) => {
      const anchor = Object.assign(document.createElement('a'), { href: to });
      anchor.dataset.prefetch = '';
      document.body.append(anchor);
      anchor.dispatchEvent(new PointerEvent('pointerenter'));
    }, href);

  test('a reply with no page still throws away what was fetched ahead', async ({ page }) => {
    await openRace(page, at('/action-race'));
    const gets = countPayloadGets(page, '/action-race');
    const renders = await page.locator('[data-race-renders]').textContent();
    const label = unique('after-prefetch');

    await prefetchLink(page, '/action-race?view=ahead');
    await expect.poll(() => gets.count).toBe(1);
    await page.waitForTimeout(200);

    expect(await page.evaluate((name) => window.__race(name, 0), label)).toBe(label);
    // The contract of a result-only reply: this page is not rendered again, and nothing is re-read for it.
    await page.waitForTimeout(300);
    await expect(page.locator('[data-race-renders]')).toHaveText(renders);
    await expect(entry(page, label)).toHaveCount(0);
    expect(gets.count).toBe(1);

    await page.evaluate(() => navigation.navigate('/action-race?view=ahead').finished);
    await expect(entry(page, label), 'the page navigated to was rendered after the mutation').toBeVisible();
    expect(gets.count).toBe(2);
  });

  test('a payload fetched ahead while the function was running is thrown away when it finishes', async ({ page }) => {
    await openRace(page, at('/action-race'));
    const gets = countPayloadGets(page, '/action-race');
    const label = unique('during-prefetch');

    // The function sleeps before it applies; the fetch ahead starts and finishes inside that sleep.
    const call = page.evaluate((name) => window.__race(name, 600), label);
    await page.waitForTimeout(100);
    await prefetchLink(page, '/action-race?view=during');
    await expect.poll(() => gets.count).toBe(1);
    expect(await call).toBe(label);

    await page.evaluate(() => navigation.navigate('/action-race?view=during').finished);
    await expect(entry(page, label)).toBeVisible();
    expect(gets.count).toBe(2);
  });

  test('a navigation that starts while a function is running does not use a payload from before the call', async ({ page }) => {
    await openRace(page, at('/action-race'));
    const gets = countPayloadGets(page, '/action-race');
    const label = unique('nav-during');

    await prefetchLink(page, '/action-race?view=before');
    await expect.poll(() => gets.count).toBe(1);
    await page.waitForTimeout(200);

    const call = page.evaluate((name) => window.__race(name, 300), label);
    await page.waitForTimeout(50);
    await page.evaluate(() => navigation.navigate('/action-race?view=before').finished);
    expect(gets.count, 'it fetched its own, after the call began').toBe(2);
    await expect(page).toHaveURL(at('/action-race?view=before'));
    // The caller still gets its value: losing the screen is not losing the reply.
    expect(await call).toBe(label);
  });
});
