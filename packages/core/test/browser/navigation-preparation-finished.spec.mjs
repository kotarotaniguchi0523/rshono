import { expect, test } from '@playwright/test';

test('native navigation finishes only after a prepared payload commits', async ({ page }) => {
  await page.goto('/navigation-async-boundary');
  await expect(page.locator('html')).toHaveAttribute('data-navigation-repro-hydrated', 'true');
  await page.evaluate(() => {
    const navigate = navigation.navigate.bind(navigation);
    navigation.navigate = (...args) => {
      const result = navigate(...args);
      window.__nativeFinished = 'waiting';
      void result.finished.then(
        () => (window.__nativeFinished = 'resolved'),
        () => (window.__nativeFinished = 'rejected'),
      );
      return result;
    };
  });

  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-activity-render-attempted', 'true');
  await expect(page.getByText('pending: true', { exact: true })).toBeVisible();
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__nativeFinished)).toBe('waiting');

  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__nativeFinished)).toBe('resolved');
});
