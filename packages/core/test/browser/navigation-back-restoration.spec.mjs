import { expect, test } from '@playwright/test';

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
