import { expect, test } from '@playwright/test';
import { emulateBrowserWithoutPrecommit } from './navigation-probe.mjs';

test('a prevented browser navigation cancels an unapplied fetch and clears pending', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (input instanceof Request && new URL(input.url).pathname === '/users' && input.headers.get('rsc') === '1') {
        window.__auditHeldFetch = true;
        window.__auditFetchCount = (window.__auditFetchCount ?? 0) + 1;
        return new Promise((_resolve, reject) => {
          const cancel = () => {
            window.__auditFetchAborted = true;
            reject(input.signal.reason);
          };
          if (input.signal.aborted) cancel();
          else input.signal.addEventListener('abort', cancel, { once: true });
        });
      }
      return original(input, init);
    };
  });
  await page.goto('/profile/1');
  await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
  await page.evaluate(() => {
    const result = navigation.navigate('/users');
    void Promise.allSettled([result.committed, result.finished]);
  });
  await expect.poll(() => page.evaluate(() => window.__auditHeldFetch)).toBe(true);
  await expect(page.locator('[data-nav="pending"]')).toHaveText('yes');
  await page.evaluate(async () => {
    navigation.addEventListener('navigate', (event) => event.preventDefault(), { once: true });
    const result = navigation.navigate('#cancelled');
    await Promise.allSettled([result.committed, result.finished]);
  });
  await expect.poll(() => page.evaluate(() => window.__auditFetchAborted)).toBe(true);
  expect(await page.evaluate(() => window.__auditFetchCount)).toBe(1);
  await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Back during an unapplied Docs request keeps the home island hydrated', async ({ page }) => {
  await emulateBrowserWithoutPrecommit(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (input instanceof Request && new URL(input.url).pathname === '/docs/getting-started' && input.headers.get('rsc') === '1') {
        window.__auditDocsRequested = true;
        return new Promise((_resolve, reject) => {
          const cancel = () => {
            window.__auditDocsAborted = true;
            reject(input.signal.reason);
          };
          if (input.signal.aborted) cancel();
          else input.signal.addEventListener('abort', cancel, { once: true });
        });
      }
      return original(input, init);
    };
  });
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  const marker = await page.evaluate(() => (window.__auditDocument = crypto.randomUUID()));
  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL('/docs/getting-started');
  await expect.poll(() => page.evaluate(() => window.__auditDocsRequested)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect.poll(() => page.evaluate(() => window.__auditDocsAborted)).toBe(true);
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  expect(await page.evaluate(() => window.__auditDocument)).toBe(marker);
  expect(errors).toEqual([]);
});

test('Back cancels a payload already scheduled behind client Suspense', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/navigation-suspense');
  await expect(page.locator('html')).toHaveAttribute('data-navigation-repro-hydrated', 'true');
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-activity-render-attempted', 'true');
  await expect(page.getByText('pending: true', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/navigation-suspense');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  // A fresh query navigation drains any retry of the old payload, without a timing-based negative assertion.
  await page.evaluate(async () => {
    const result = navigation.navigate('?tab=latest');
    await Promise.all([result.committed, result.finished]);
  });
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.getByText('Activity content', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Back between fragments preserves the committed page stream', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/streamed-boundary-a');
  await expect(page.locator('[data-streamed-content="a"]')).toBeVisible();
  await page.getByRole('link', { name: 'next' }).click();
  await expect(page.locator('[data-streamed-loading="b"]')).toBeVisible();
  await page.evaluate(async () => {
    const result = navigation.navigate('#during-stream');
    await Promise.all([result.committed, result.finished]);
  });
  await page.goBack();
  await expect(page).toHaveURL('/streamed-boundary-b');
  await expect(page.locator('[data-streamed-content="b"]')).toBeVisible();
  await expect(page.locator('[data-streamed-error="b"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
