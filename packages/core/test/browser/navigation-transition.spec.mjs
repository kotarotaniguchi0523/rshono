import { expect, test } from '@playwright/test';

test('navigation retains revealed Suspense content until the destination is ready', async ({ page }) => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/__navigation-suspense-probe', async (route) => {
    await held;
    await route.fulfill({ status: 200, body: 'ready' });
  });
  await page.goto('/profile/1');
  await expect(page.locator('[data-probe="content"]')).toHaveText('Initial content');
  await expect(page.locator('[data-nav="hash"]')).toHaveText('(none)');
  await page.evaluate(() => {
    window.__probeDocument = 'same-document';
  });

  const suspended = page.waitForRequest('**/__navigation-suspense-probe');
  await page.getByRole('button', { name: 'Navigate to suspended content', exact: true }).click();
  await expect(page).toHaveURL('/profile/1?tab=activity');
  // Wait for the fetched payload to render and reach the controlled client suspension.
  await suspended;
  await expect(page.locator('[data-probe="content"]')).toBeVisible();
  await expect(page.locator('[data-probe="content"]')).toHaveText('Initial content');
  await expect(page.locator('[data-probe="fallback"]')).toBeHidden();
  await expect(page.locator('[data-probe="pending"]')).toHaveText('yes');

  release();
  await expect(page.locator('[data-probe="content"]')).toHaveText('Activity content');
  await expect(page.locator('[data-probe="pending"]')).toHaveText('no');
  expect(await page.evaluate(() => window.__probeDocument)).toBe('same-document');
});
