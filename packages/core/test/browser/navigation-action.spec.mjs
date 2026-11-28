import { expect, test } from '@playwright/test';

test('a server action completing under a post-commit navigation leaves the destination current', async ({ page }) => {
  // This browser supports precommit, where the URL is held until the payload arrives. Remove the interface the runtime feature-detects so this test keeps
  // covering the post-commit path instead: the URL has already committed, the older loader is still on the
  // wire. The action does not take the screen from it; the destination commits and is then re-read.
  await page.addInitScript(() => {
    delete window.NavigationPrecommitController;
  });
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

/*
 * A reply may change the screen only if nothing has asked to navigate since the call. A `redirect()` is a
 * change of screen like the re-rendered page is, so the same test applies: the visitor who has moved on in
 * the meantime is not pulled to wherever the old page's action wanted to go.
 */
test('a redirect from an action of a page the visitor has left is not followed', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let replied;
  const reply = new Promise((resolve) => {
    replied = resolve;
  });
  await page.route('**/login', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const body = await response.body();
    replied();
    await held;
    await route.fulfill({ response, body });
  });
  try {
    await page.locator('input[name="email"]').fill('stale-redirect@example.com');
    await page.locator('form button[type="submit"]').click();
    // The server has run the action and answered with the redirect; the browser has not been given it yet.
    await reply;
    // Not awaited: React entangles a navigation's transition with a pending action's, so on 19.3.1 the
    // destination does not commit until the action's reply has been read. Its payload is fetched meanwhile.
    const fetched = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith('/users'));
    await page.evaluate(() => void navigation.navigate('/users').finished.catch(() => {}));
    await fetched;
    // The page the visitor ends up on is re-read once the navigation is through: it was rendered before the
    // reply was read. Waiting for that also gives a stray redirect the time to have happened.
    const reread = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith('/users'));
    release();
    await reread;
    await expect(page).toHaveURL('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  } finally {
    release?.();
  }
});
