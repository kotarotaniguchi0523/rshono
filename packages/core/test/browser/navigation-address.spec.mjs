import { expect, test } from '@playwright/test';

// Exercise a client resource selected by the URL, independently of the server payload.
test('a live URL consumer retains revealed content and recovers on Back', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/navigation-address-suspense');
  await expect(page.locator('html')).toHaveAttribute('data-navigation-repro-hydrated', 'true');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await expect(page).toHaveURL('/navigation-address-suspense?tab=activity');
  await expect(page.locator('html')).toHaveAttribute('data-activity-render-attempted', 'true');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading...', { exact: true })).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL('/navigation-address-suspense');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading...', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Activity content', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Sample rendered frames, not just the final DOM: a transient hidden boundary must fail too.
async function watchContentFrames(page) {
  await page.evaluate(() => {
    window.__navigationFrames = { blank: 0, checked: 0, stopped: false };
    const check = () => {
      const state = window.__navigationFrames;
      if (state.stopped) return;
      const content = [...document.querySelectorAll('[data-navigation-repro] p')].find(
        (node) => /^(Initial|Activity) content$/.test(node.textContent) && node.getClientRects().length > 0,
      );
      state.checked++;
      if (!content) state.blank++;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await expect.poll(() => page.evaluate(() => window.__navigationFrames.checked)).toBeGreaterThan(1);
}

test('URL-selected Suspense resolves without a blank frame or a stuck pending state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/navigation-address-suspense');
  await expect(page.locator('html')).toHaveAttribute('data-navigation-repro-hydrated', 'true');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await watchContentFrames(page);
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: 'Navigate', exact: true }).click();
    await expect(page).toHaveURL('/navigation-address-suspense?tab=activity');
    await expect(page.locator('html')).toHaveAttribute('data-activity-render-attempted', 'true');
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await expect(page.getByText('Loading...', { exact: true })).toBeHidden();
    await expect(page.getByText('pending: true', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
    await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await page.evaluate(() => delete document.documentElement.dataset.activityRenderAttempted);
  }
  const frames = await page.evaluate(() => {
    window.__navigationFrames.stopped = true;
    return window.__navigationFrames;
  });
  expect(frames.checked).toBeGreaterThan(1);
  expect(frames.blank).toBe(0);
  expect(errors).toEqual([]);
});

test('initial static query and fragment hydrate, reload and remain interactive', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (let round = 0; round < 2; round++) {
    if (round === 0) await page.goto('/docs/getting-started?tab=activity#initial-anchor');
    else await page.reload();
    await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
    await expect(page.locator('[data-nav="hash"]')).toHaveText('#initial-anchor');
    await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.getByRole('button', { name: "push('/users')" }).click();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
  await expect(page.locator('[data-nav="hash"]')).toHaveText('#initial-anchor');
  await expect(page.locator('h1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('history.replaceState updates the live URL on a prerendered page', async ({ page }) => {
  await page.goto('/docs/getting-started');
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('(none)');
  await page.evaluate(() => history.replaceState(null, '', '?tab=activity#install'));
  await expect(page).toHaveURL('/docs/getting-started?tab=activity#install');
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
  await expect(page.locator('[data-nav="hash"]')).toHaveText('#install');
  await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible();
});

test('server-rendered content remains available without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    const response = await page.goto('/navigation-address-suspense');
    expect(response.status()).toBe(200);
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Navigate', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
