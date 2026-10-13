import { expect, test } from '@playwright/test';
async function browserNavigate(page, href) {
  await page.evaluate((href) => {
    const result = navigation.navigate(href);
    void Promise.allSettled([result.committed, result.finished]);
  }, href);
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__boundaryDocument = crypto.randomUUID();
  });
  page.__boundaryErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.__boundaryErrors).toEqual([]);
  await expect(page.locator('[data-rshono-fatal]')).toHaveCount(0);
});

async function open(page, path) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-navigation-repro-hydrated', 'true');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
}

async function suspend(page) {
  await page.evaluate(() => delete document.documentElement.dataset.activityRenderAttempted);
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-activity-render-attempted', 'true');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading...', { exact: true })).toBeHidden();
  await expect(page.getByText('pending: true', { exact: true })).toBeVisible();
}

for (const path of ['/navigation-async-boundary', '/navigation-async-nested']) {
  test(`${path}: a query transition retains content and resolves in the nearest boundary`, async ({ page }) => {
    await open(page, path);
    const documentId = await page.evaluate(() => window.__boundaryDocument);
    await suspend(page);
    if (path.endsWith('nested')) {
      await expect(page.getByText('Outer content', { exact: true })).toBeVisible();
      await expect(page.getByText('Outer loading', { exact: true })).toBeHidden();
    }
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
    await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__boundaryDocument)).toBe(documentId);
  });

  test(`${path}: rejection stays local, retry works, and query reset recovers`, async ({ page }) => {
    await open(page, path);
    await suspend(page);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByText('Resource failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: path, exact: true })).toBeVisible();
    await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
    await expect(page.getByText('Outer failed', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await suspend(page);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByText('Resource failed', { exact: true })).toBeVisible();
    // resetKeys uses the query deliberately: same-path error recovery is an explicit boundary contract.
    await page.goBack();
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await expect(page.getByText('Resource failed', { exact: true })).toBeHidden();
  });

  test(`${path}: Back abandons suspension and Forward can finish it`, async ({ page }) => {
    await open(page, path);
    await suspend(page);
    await page.goBack();
    await expect(page).toHaveURL(path);
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
    await page.evaluate(() => delete document.documentElement.dataset.activityRenderAttempted);
    await page.goForward();
    await expect(page.locator('html')).toHaveAttribute('data-activity-render-attempted', 'true');
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
    await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
  });
}

test('an address change does not remount the outgoing AsyncBoundary before its replacement arrives', async ({ page }) => {
  await open(page, '/navigation-async-boundary');
  const mounts = Number(await page.locator('html').getAttribute('data-navigation-content-mounts'));
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/navigation-async-other', async (route) => {
    if (route.request().headers()['rsc'] !== '1') return route.fallback();
    await held;
    await route.continue();
  });
  try {
    await page.evaluate(async () => {
      // Seed a future history entry without fetching it; the real traversal below is the subject.
      const intercept = NavigateEvent.prototype.intercept;
      try {
        NavigateEvent.prototype.intercept = () => {};
        history.pushState(null, '', '/navigation-async-other');
      } finally {
        NavigateEvent.prototype.intercept = intercept;
      }
      await navigation.back().finished;
      const result = navigation.forward();
      void Promise.allSettled([result.committed, result.finished]);
    });
    await expect(page).toHaveURL('/navigation-async-other');
    await expect(page.locator('[data-nav="pathname"]')).toHaveText('/navigation-async-other');
    await expect(page.getByRole('heading', { name: '/navigation-async-boundary', exact: true })).toBeVisible();
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    expect(Number(await page.locator('html').getAttribute('data-navigation-content-mounts'))).toBe(mounts);
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: '/navigation-async-other', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator('html').getAttribute('data-navigation-content-mounts'))).toBe(mounts + 1);
});

test('an errored AsyncBoundary resets on another path and remains navigable', async ({ page }) => {
  await open(page, '/navigation-async-boundary');
  await suspend(page);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Resource failed', { exact: true })).toBeVisible();
  await browserNavigate(page, '/navigation-async-other');
  await expect(page.getByRole('heading', { name: '/navigation-async-other', exact: true })).toBeVisible();
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('Resource failed', { exact: true })).toBeHidden();
  await suspend(page);
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
});

test('streamed AsyncBoundary content completes through Back and Forward without a document reload', async ({ page }) => {
  await page.goto('/streamed-boundary-a');
  await expect(page.locator('html')).toHaveAttribute('data-streamed-boundary-hydrated', 'true');
  await expect(page.locator('[data-streamed-content="a"]')).toBeVisible();
  const documentId = await page.evaluate(() => window.__boundaryDocument);
  await page.getByRole('link', { name: 'next', exact: true }).click();
  await expect(page.locator('[data-streamed-loading="b"]')).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-streamed-content="a"]')).toBeVisible();
  await page.goForward();
  await expect(page.locator('[data-streamed-content="b"]')).toBeVisible();
  expect(await page.evaluate(() => window.__boundaryDocument)).toBe(documentId);
});

test('an omitted inner error fallback propagates to the outer AsyncBoundary and recovers on navigation', async ({ page }) => {
  await open(page, '/navigation-async-propagate');
  await suspend(page);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Outer failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Resource failed', { exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name: '/navigation-async-propagate', exact: true })).toBeVisible();
  await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
  await browserNavigate(page, '/navigation-async-other');
  await expect(page.getByRole('heading', { name: '/navigation-async-other', exact: true })).toBeVisible();
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('Outer failed', { exact: true })).toBeHidden();
});
