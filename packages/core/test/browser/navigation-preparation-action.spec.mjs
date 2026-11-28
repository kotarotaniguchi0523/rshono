import { expect, test } from '@playwright/test';

/*
 * A navigation is on the wire, its payload rendered before the mutation, when an action from the page being
 * left completes. The action must not take the navigation away — the visitor asked to go there — and the
 * destination must not stay on the older snapshot either: it commits, and is then re-read.
 */
test('a server action leaves a navigation under way alone, and its destination is re-read', async ({ page }) => {
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
      const result = navigation.navigate('?audit=snapshot');
      void Promise.allSettled([result.committed, result.finished]).then((outcomes) => {
        window.__auditNativeFinished = true;
        window.__auditPreparationRejected = outcomes[1].status === 'rejected';
      });
    });
    await ready;
    await expect(page).toHaveURL('/users');
    const email = `audit-snapshot-${crypto.randomUUID()}@example.com`;
    await page.getByPlaceholder('Grace Hopper').fill('Snapshot probe');
    await page.getByPlaceholder('grace@example.com').fill(email);
    const actionResponse = page.waitForResponse((response) => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add user' }).click();
    expect(await (await actionResponse).text()).toContain(email);
    release();
    await expect.poll(() => page.evaluate(() => window.__auditNativeFinished)).toBe(true);
    expect(await page.evaluate(() => window.__auditPreparationRejected)).toBe(false);
    await expect(page).toHaveURL('/users?audit=snapshot');
    // Not in the payload the navigation committed — that one was rendered before the action ran.
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  } finally {
    release?.();
  }
});
