import { expect, test } from '@playwright/test';
import { holdNextPayload, unique } from './payload-holds.mjs';

/*
 * Redirects, 404s and actions against the navigations around them — the cases Waku's router suites
 * (`waku-navigation-integration`, `ssr-redirect`, `use-router`, `ssr-catch-error`) cover and this one did not.
 * Each test says which behaviour it pins; one of them pins a deliberate difference.
 */

async function open(page, path) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const soft = (page, href) => page.evaluate((to) => navigation.navigate(to).finished.then(() => 'finished'), href);

/** The pathname + search + hash of every entry in this tab's session history, oldest first. */
const entries = (page) =>
  page.evaluate(() =>
    navigation.entries().map((entry) => {
      const url = new URL(entry.url);
      return url.pathname + url.search + url.hash;
    }),
  );

test('a redirect to the same path with a different query renders the target, as one entry', async ({ page }) => {
  await open(page, '/');
  await page.evaluate(() => void navigation.navigate('/canonical').finished.catch(() => {}));

  await expect(page.locator('[data-canonical]')).toHaveText('Canonical new');
  await expect(page).toHaveURL('/canonical?v=new');
  // The URL that redirected never became an entry: Back would only bounce off it into the same redirect.
  expect(await entries(page)).toEqual(['/', '/canonical?v=new']);
});

test('a redirect that has completed does not interfere with the navigation after it', async ({ page }) => {
  await open(page, '/');
  await page.evaluate(() => void navigation.navigate('/canonical').finished.catch(() => {}));
  await expect(page.locator('[data-canonical]')).toHaveText('Canonical new');

  expect(await soft(page, '/users')).toBe('finished');
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await expect(page).toHaveURL('/users');
  expect(await entries(page)).toEqual(['/', '/canonical?v=new', '/users']);
});

test('router.replace swaps the entry instead of adding one', async ({ page }) => {
  await open(page, '/');
  expect(await soft(page, '/users')).toBe('finished');
  await page.evaluate(() => navigation.navigate('/about', { history: 'replace' }).finished);
  await expect(page).toHaveURL('/about');
  expect(await entries(page)).toEqual(['/', '/about']);

  await page.goBack();
  await expect(page).toHaveURL('/');
});

test('Back out of a 404 reached by soft navigation restores the page before it', async ({ page }) => {
  await open(page, '/users');
  await page.evaluate(() => void navigation.navigate('/no-such-page').finished.catch(() => {}));
  await expect(page.getByRole('heading', { level: 1, name: '404 — nothing here' })).toBeVisible();
  await expect(page).toHaveURL('/no-such-page');

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await expect(page).toHaveURL('/users');
});

test('an action called from the 404 page re-renders that page and returns its value', async ({ page }) => {
  await open(page, '/no-such-page');
  await page.waitForFunction(() => document.documentElement.dataset.actionRaceReady === 'true');
  const count = page.locator('[data-not-found-count]');
  const before = Number(await count.textContent());
  const label = unique('from-404');

  // The page an action re-renders is whatever answers the URL it was called from — here, the 404 page. That
  // payload is marked not-found like any 404, which says what the *page* is and nothing about the action.
  const returned = await page.evaluate((name) => window.__race(name, 0), label);

  expect(returned).toBe(label);
  await expect(count).toHaveText(String(before + 1));
  await expect(page).toHaveURL('/no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: '404 — nothing here' })).toBeVisible();
});

test('an action after a fragment-only navigation re-renders the page and keeps the fragment', async ({ page }) => {
  await open(page, '/action-race');
  await page.waitForFunction(() => document.documentElement.dataset.actionRaceReady === 'true');
  await page.evaluate(() => navigation.navigate('#details').finished);
  const label = unique('after-fragment');

  expect(await page.evaluate((name) => window.__race(name, 0), label)).toBe(label);

  await expect(page.locator(`[data-race-entry="${label}"]`)).toBeVisible();
  await expect(page).toHaveURL('/action-race#details');
});

test('a newer navigation wins over an action’s redirect that is still loading', async ({ page }) => {
  await open(page, '/action-race');
  const hold = await holdNextPayload(page, '/about');
  try {
    // The action redirects to /about, whose payload is kept waiting.
    await page.locator('[data-raise-signal] input[name="to"]').fill('/about');
    await page.locator('[data-raise-signal] button').click();
    await hold.snapshotTaken;

    expect(await soft(page, '/users')).toBe('finished');
    hold.release();
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL('/users');
  } finally {
    hold.release();
  }
});

test('an action’s redirect to another origin leaves the site', async ({ page }) => {
  await page.route('https://example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>elsewhere</h1>' }));
  await open(page, '/action-race');

  await page.locator('[data-raise-signal] input[name="to"]').fill('https://example.test/elsewhere');
  await page.locator('[data-raise-signal] button').click();

  await expect(page).toHaveURL('https://example.test/elsewhere');
  await expect(page.getByRole('heading', { name: 'elsewhere' })).toBeVisible();
});

test('an action’s notFound() shows the app’s 404 page at the URL it was posted to', async ({ page }) => {
  await open(page, '/action-race');

  await page.locator('[data-raise-signal] button').click();

  await expect(page.getByRole('heading', { level: 1, name: '404 — nothing here' })).toBeVisible();
  await expect(page).toHaveURL('/action-race');
});

/*
 * A deliberate difference from Waku, which drops a late redirect once the visitor has made a fragment-only
 * navigation. There the intent arrives beside the tree and can simply be ignored. Here it arrives as an error
 * inside the tree: ignoring it leaves the page without its root, and the document load that repairs that asks
 * the server for the same page, which redirects again. So a fragment move — which does not change what page
 * the visitor is on — does not take the page's right to redirect.
 */
test('a late redirect is still followed after a fragment-only navigation', async ({ page }) => {
  await open(page, '/');
  const id = unique('fragment');
  await page.evaluate((href) => navigation.navigate(href).finished, `/gated-intent?gate=${id}&to=/login`);
  await expect(page.locator('[data-gated="waiting"]')).toBeVisible();
  await page.evaluate(() => navigation.navigate('#somewhere').finished);

  expect(await page.evaluate((gate) => fetch(`/api/gate?id=${gate}`, { method: 'POST' }).then((response) => response.ok), id)).toBe(true);

  await expect(page).toHaveURL('/login');
  await expect(page.locator('input[name="email"]')).toBeVisible();
});
