import { expect, test } from '@playwright/test';

test('a streamed render superseded by another page cannot scroll or abort its replacement', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/profile/1');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  await page.evaluate(() => {
    const result = navigation.navigate('/anchor-stream#depth-target');
    void Promise.allSettled([result.committed, result.finished]);
  });
  await expect(page.locator('[data-anchor-loading]')).toBeVisible();
  await page.evaluate(() => {
    const result = navigation.navigate('/profile/2');
    void Promise.allSettled([result.committed, result.finished]);
  });
  await expect(page.getByRole('heading', { name: /Alan Turing/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: /refresh/ }).click();
  await expect(page.getByRole('heading', { name: /Alan Turing/ })).toBeVisible();
  expect(errors).toEqual([]);
});
