import { expect, test } from '@playwright/test';

async function startNativeNavigation(page, method, href) {
  await page.evaluate(
    ({ method, href }) => {
      window.__preparationResult = { state: 'waiting' };
      const result = navigation.navigate(href, { history: method });
      void result.committed.catch(() => {});
      void result.finished.then(
        () => {
          window.__preparationResult = { state: 'resolved', kind: 'rendered', url: location.href };
        },
        (error) => {
          window.__preparationResult = { state: 'rejected', name: error.name };
        },
      );
    },
    { method, href },
  );
}
async function navigationResult(page) {
  return page.evaluate(() => window.__preparationResult);
}

for (const method of ['push', 'replace']) {
  test(`precommit ${method} holds the URL and reports pending before the root arrives`, async ({ page }) => {
    await page.goto('/profile/1');
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let requestSeen;
    const seen = new Promise((resolve) => {
      requestSeen = resolve;
    });
    let requests = 0;
    await page.route('**/profile/1?tab=activity', async (route) => {
      if (route.request().headers()['rsc'] !== '1') return route.fallback();
      requests++;
      requestSeen();
      await held;
      await route.continue();
    });
    try {
      await startNativeNavigation(page, method, '?tab=activity');
      await seen;
      await expect(page.locator('[data-nav="pending"]')).toHaveText('yes');
      expect(new URL(page.url()).search).toBe('');
      expect(await navigationResult(page).then((result) => result.state)).toBe('waiting');
    } finally {
      release?.();
    }
    await expect.poll(() => navigationResult(page).then((result) => result.state)).toBe('resolved');
    await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
    await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
    expect(requests).toBe(1);
  });
}

test('precommit failure leaves the URL and existing screen intact', async ({ page }) => {
  await page.goto('/profile/1');
  await page.route('**/profile/1?tab=activity', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
  await startNativeNavigation(page, 'push', '?tab=activity');
  await expect.poll(() => navigationResult(page).then((result) => result.state)).toBe('rejected');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
});

test('precommit commits the shell without waiting for the streamed child', async ({ page }) => {
  await page.goto('/profile/1');
  await startNativeNavigation(page, 'push', '/anchor-stream#depth-target');
  await expect.poll(() => navigationResult(page).then((result) => result.state)).toBe('resolved');
  await expect(page).toHaveURL('/anchor-stream#depth-target');
  await expect(page.locator('[data-anchor-loading]')).toBeVisible();
  await expect(page.locator('#depth-target')).toHaveCount(0);
  await expect(page.locator('#depth-target')).toBeVisible();
});

test('automatic preparation marks the router pending while an additional browser gate is held', async ({ page }) => {
  await page.goto('/profile/1');
  await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
  const probe = await page.evaluate(async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let entered;
    const enteredGate = new Promise((resolve) => {
      entered = resolve;
    });
    const listener = (event) => {
      event.intercept({
        precommitHandler: async () => {
          entered();
          await gate;
        },
      });
    };
    navigation.addEventListener('navigate', listener, { once: true });
    const result = navigation.navigate('?tab=activity');
    await enteredGate;
    // The browser may start the two precommit handlers on different frames.
    const pending = () => document.querySelector('[data-nav="pending"]')?.textContent;
    const deadline = performance.now() + 2000;
    while (pending() !== 'yes' && performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
    }
    const held = { url: location.search, pending: document.querySelector('[data-nav="pending"]')?.textContent };
    release();
    await result.finished;
    return held;
  });
  expect(probe).toEqual({ url: '', pending: 'yes' });
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
});

for (const target of ['/audit-loop', 'https://example.com/elsewhere', '//example.com/elsewhere', 'javascript:alert(1)', 'data:text/html,unsafe']) {
  test(`precommit rejects unsafe root redirect ${target} before changing the URL`, async ({ page }) => {
    await page.goto('/profile/1');
    const externalRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== new URL(page.url()).origin) externalRequests.push(request.url());
    });
    await page.route('https://example.com/**', (route) => route.abort());
    await page.route('**/audit-loop', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/x-component',
        body: `0:${JSON.stringify({ root: null, redirect: target })}\n`,
      }),
    );
    await startNativeNavigation(page, 'push', '/audit-loop');
    await expect.poll(() => navigationResult(page).then((result) => result.state)).toBe('rejected');
    await expect(page).toHaveURL('/profile/1');
    await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
    await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
    expect(externalRequests).toEqual([]);
  });
}
