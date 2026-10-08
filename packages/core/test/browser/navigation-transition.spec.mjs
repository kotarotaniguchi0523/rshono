import { expect, test } from '@playwright/test';

test('verify the exact button-controlled reproduction', async ({ page }) => {
  const fixed = process.env.RSHONO_EXPECT_TRANSITION === '1';
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/profile/1');
  await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
  await expect(page.locator('[data-nav="hash"]')).toHaveText('(none)');
  await page.evaluate(() => { window.__probeDocument = 'same-document'; });

  const received = page.waitForResponse((response) =>
    response.request().headers()['rsc'] === '1' && response.url().endsWith('/profile/1?tab=activity'),
  );
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  await expect(page).toHaveURL('/profile/1?tab=activity');
  const response = await received;
  expect(await response.finished()).toBeNull();

  if (fixed) {
    await expect(page.getByText('pending: true', { exact: true })).toBeVisible();
    await expect(page.getByText('Initial content', { exact: true })).toBeVisible();
    await expect(page.getByText('Loading...', { exact: true })).toBeHidden();
  } else {
    await expect(page.getByText('Loading...', { exact: true })).toBeVisible();
    await expect(page.getByText('Initial content', { exact: true })).toBeHidden();
    await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
  }

  console.log(JSON.stringify({ phase: 'before Resolve', fixed,
    initialVisible: await page.getByText('Initial content', { exact: true }).isVisible(),
    fallbackVisible: await page.getByText('Loading...', { exact: true }).isVisible(),
    pending: await page.getByText(/^pending: /).textContent(),
  }));

  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Activity content', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading...', { exact: true })).toBeHidden();
  await expect(page.getByText('pending: false', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__probeDocument)).toBe('same-document');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ phase: 'after Resolve', fixed, activityVisible: true, pending: false, sameDocument: true, pageErrors: errors }));
});
