import { expect, test } from '@playwright/test';
import { routerResult, startRouterCall } from './navigation-probe.mjs';

test('root redirect completes on the final screen', async ({ page }) => {
  await page.goto('/profile/1');
  await page.route('**/audit-redirect', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/x-component',
      body: '0:{"root":null,"redirect":"/login"}\n',
    }),
  );
  await startRouterCall(page, 'push', '/audit-redirect');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  const outcome = await routerResult(page);
  expect(outcome.kind).toBe('rendered');
  expect(new URL(outcome.url).pathname).toBe('/login');
  expect(outcome.heading).toBe('Log in');
});

for (const method of ['push', 'replace', 'refresh', 'back', 'forward']) {
  test(`${method} resolves after the destination payload commits`, async ({ page }) => {
    await page.goto('/profile/1');
    await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
    if (method === 'back' || method === 'forward') {
      await startRouterCall(page, 'push', '/profile/2');
      await expect(page.getByRole('heading', { name: /Alan Turing/ })).toBeVisible();
      if (method === 'forward') {
        await startRouterCall(page, 'back');
        await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
      }
    }
    const destination = method === 'forward' ? '/profile/2' : '/profile/1';
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let requestSeen;
    const seen = new Promise((resolve) => {
      requestSeen = resolve;
    });
    await page.route(`**${destination}*`, async (route) => {
      if (route.request().headers()['rsc'] !== '1') return route.fallback();
      requestSeen();
      await held;
      if (method === 'refresh') {
        const response = await route.fetch();
        const body = (await response.text()).replaceAll('Ada Lovelace', 'Ada Refreshed');
        await route.fulfill({ response, body });
      } else await route.continue();
    });
    try {
      await startRouterCall(page, method, '/profile/1?tab=activity');
      await seen;
      expect(await routerResult(page)).toEqual({ state: 'waiting' });
    } finally {
      release?.();
    }
    await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
    const result = await routerResult(page);
    expect(result.kind).toBe('rendered');
    expect(result.heading).toContain(method === 'forward' ? 'Alan Turing' : method === 'refresh' ? 'Ada Refreshed' : 'Ada Lovelace');
  });
}

test('rejects a superseded navigation and finishes its replacement', async ({ page }) => {
  await page.goto('/profile/1');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let requestSeen;
  const seen = new Promise((resolve) => {
    requestSeen = resolve;
  });
  await page.route('**/profile/1?tab=activity', async (route) => {
    if (route.request().headers()['rsc'] !== '1') return route.fallback();
    requestSeen();
    await held;
    await route.continue();
  });
  try {
    await startRouterCall(page, 'push', '?tab=activity');
    await seen;
    await startRouterCall(page, 'push', '/users', 'secondary');
    await expect.poll(() => routerResult(page)).toEqual({ state: 'rejected', name: 'AbortError' });
    await expect
      .poll(() => routerResult(page, 'secondary'))
      .toEqual(expect.objectContaining({ state: 'resolved', kind: 'rendered', heading: 'Users' }));
  } finally {
    release?.();
  }
});

test('hash completion and forward completion refer to the committed entry', async ({ page }) => {
  await page.goto('/profile/1');
  await startRouterCall(page, 'push', '#posts');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  expect(new URL((await routerResult(page)).url).hash).toBe('#posts');
  await startRouterCall(page, 'back');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  await startRouterCall(page, 'forward');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  expect(new URL((await routerResult(page)).url).hash).toBe('#posts');
});

test('forward without an entry resolves as no-op', async ({ page }) => {
  await page.goto('/profile/1');
  await startRouterCall(page, 'forward');
  await expect.poll(() => routerResult(page).then((result) => result.kind)).toBe('no-op');
});

test('Navigation API finished is earlier than a traversal payload commit', async ({ page }) => {
  await page.goto('/profile/1');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  await page.getByRole('button', { name: "push('/users')" }).click();
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  let requestSeen;
  const seen = new Promise((resolve) => (requestSeen = resolve));
  await page.route('**/profile/1', async (route) => {
    if (route.request().headers()['rsc'] !== '1') return route.fallback();
    requestSeen();
    await held;
    await route.continue();
  });
  try {
    const result = await page.evaluate(async () => {
      const { finished } = navigation.back();
      await finished;
      return { pathname: location.pathname, heading: document.querySelector('h1')?.textContent };
    });
    await seen;
    expect(result.pathname).toBe('/profile/1');
    expect(result.heading).toContain('Users');
  } finally {
    release?.();
  }
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
});

test('a digest redirect reports a document handoff before recovering the page', async ({ page }) => {
  await page.goto('/profile/1');
  await startRouterCall(page, 'push', '/dashboard');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
  expect((await routerResult(page)).kind).toBe('document-navigation');
});

for (const method of ['back', 'forward']) {
  test(`${method} waits for a redirected destination to commit`, async ({ page }) => {
    await page.goto('/profile/1');
    await startRouterCall(page, 'push', '/profile/2');
    await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
    if (method === 'forward') {
      await startRouterCall(page, 'back');
      await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
    }
    const source = method === 'back' ? '/profile/1' : '/profile/2';
    await page.route(`**${source}`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/x-component', body: '0:{"root":null,"redirect":"/profile/3"}\n' }),
    );
    const { promise: held, resolve: release } = Promise.withResolvers();
    const { promise: seen, resolve: requestSeen } = Promise.withResolvers();
    await page.route('**/profile/3', async (route) => {
      requestSeen();
      await held;
      await route.continue();
    });
    try {
      await startRouterCall(page, method);
      await seen;
      expect((await routerResult(page)).state).toBe('waiting');
    } finally {
      release();
    }
    await expect
      .poll(() => routerResult(page))
      .toEqual(expect.objectContaining({ state: 'resolved', kind: 'rendered', heading: expect.stringContaining('Grace Hopper') }));
    expect(new URL((await routerResult(page)).url).pathname).toBe('/profile/3');
  });
}
