// One payload, read once, from the navigation that asked for it through to the render that shows it — and a
// server action's reply shown only on the page that called it.
import { expect, test } from '@playwright/test';

/** Every flight request the page makes, as `METHOD path`. */
function recordFlightRequests(page) {
  const requests = [];
  page.on('request', (request) => {
    if (request.headers()['rsc'] === '1') requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return requests;
}

test('a navigation fetches its payload once, from precommit through to the commit', async ({ page }) => {
  await page.goto('/profile/1');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  const requests = recordFlightRequests(page);

  await page.getByRole('button', { name: "push('/users')" }).click();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  // The fetch that resolved the root before the URL committed is the one React renders from: no second
  // request once the handler runs, and none after the stream ends.
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual(['GET /users']);

  await page.goBack();
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual(['GET /users', 'GET /profile/1']);
});

test('a pending React transition does not make the router fetch anything', async ({ page }) => {
  // With a transition pending and no navigation under way, React 19.3 starts a navigation of its own at the
  // current URL — `info: 'react-transition'` — so the browser shows its loading indicator. It is not a
  // navigation of the page, and answering it as one would re-fetch the payload in a loop.
  await page.goto('/navigation-async-boundary');
  await expect(page.locator('html')).toHaveAttribute('data-navigation-repro-hydrated', 'true');
  await page.evaluate(() => {
    window.__indicatorNavigations = 0;
    navigation.addEventListener('navigate', (event) => {
      if (event.info === 'react-transition') window.__indicatorNavigations++;
    });
  });
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await expect(page.getByText('pending: true', { exact: true })).toBeVisible();
  const requests = recordFlightRequests(page);
  // Long enough for the indicator's 100ms delay, several times over.
  await page.waitForTimeout(600);
  expect(requests).toEqual([]);
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
  await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
});

test("an action's reply does not repaint a page the visitor has since left", async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/users');
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let replied;
  const reply = new Promise((resolve) => (replied = resolve));
  await page.route('**/users', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    // Let the action run on the server, then hold its reply.
    const response = await route.fetch();
    const body = await response.body();
    replied();
    await held;
    await route.fulfill({ response, body });
  });
  const email = `left-behind-${crypto.randomUUID()}@example.com`;
  try {
    await page.getByPlaceholder('Grace Hopper').fill('Left behind');
    await page.getByPlaceholder('grace@example.com').fill(email);
    await page.getByRole('button', { name: 'Add user' }).click();
    await reply;

    await page.evaluate(() => void navigation.navigate('/profile/1').finished.catch(() => {}));
    // The URL has committed, so the visitor has left — though React will not *show* the new page yet: the
    // form's action is an async transition still in flight, and React finishes those together.
    await expect(page).toHaveURL('/profile/1');
  } finally {
    release();
  }
  // The reply is a render of /users. It arrives, and the page on screen is not that page.
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL('/profile/1');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  await expect(page.locator('[data-rshono-fatal]')).toHaveCount(0);
  expect(errors).toEqual([]);

  // Losing the screen is not losing the mutation.
  await page.goBack();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
