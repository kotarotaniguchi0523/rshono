import { expect, test } from '@playwright/test';

test('a completed server action supersedes an older navigation snapshot', async ({ page }) => {
  await page.goto('/users');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let snapshotReady;
  const ready = new Promise((resolve) => {
    snapshotReady = resolve;
  });
  await page.route('**/users?audit=snapshot', async (route) => {
    if (route.request().method() !== 'GET' || route.request().headers()['rsc'] !== '1') return route.continue();
    // Fetch the old response before the action mutates the database, then hold its delivery.
    const response = await route.fetch();
    const body = await response.body();
    snapshotReady();
    await held;
    await route.fulfill({ response, body });
  });
  try {
    await page.evaluate(() => {
      window.__auditNativeFinished = false;
      void navigation.navigate('?audit=snapshot').finished.then(() => {
        window.__auditNativeFinished = true;
      });
    });
    await ready;
    await expect(page).toHaveURL('/users?audit=snapshot');
    const email = `audit-snapshot-${crypto.randomUUID()}@example.com`;
    await page.getByPlaceholder('Grace Hopper').fill('Snapshot probe');
    await page.getByPlaceholder('grace@example.com').fill(email);
    const actionResponse = page.waitForResponse((response) => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add user' }).click();
    expect(await (await actionResponse).text()).toContain(email);
    release();
    await expect.poll(() => page.evaluate(() => window.__auditNativeFinished)).toBe(true);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  } finally {
    release?.();
  }
});
