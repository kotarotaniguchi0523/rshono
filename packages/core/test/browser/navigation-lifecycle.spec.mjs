import { expect, test } from '@playwright/test';
import { emulateBrowserWithoutPrecommit, routerResult, startRouterCall } from './navigation-api-probe.mjs';

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
      await startRouterCall(page, method, '?tab=activity');
      await seen;
      await expect(page.locator('[data-nav="pending"]')).toHaveText('yes');
      expect(new URL(page.url()).search).toBe('');
      expect(await routerResult(page).then((result) => result.state)).toBe('waiting');
    } finally {
      release?.();
    }
    await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
    await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
    await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
    expect(requests).toBe(1);
  });
}

test('precommit failure leaves the URL and existing screen intact', async ({ page }) => {
  await page.goto('/profile/1');
  await page.route('**/profile/1?tab=activity', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' }));
  await startRouterCall(page, 'push', '?tab=activity');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('rejected');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
});

for (const precommit of [false, true]) {
  test(`root redirect completes on the final screen (precommit=${precommit})`, async ({ page }) => {
    if (!precommit) await emulateBrowserWithoutPrecommit(page);
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
}

test('precommit commits the shell without waiting for the streamed child', async ({ page }) => {
  await page.goto('/profile/1');
  await startRouterCall(page, 'push', '/anchor-stream#depth-target');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  await expect(page).toHaveURL('/anchor-stream#depth-target');
  await expect(page.locator('[data-anchor-loading]')).toBeVisible();
  await expect(page.locator('#depth-target')).toHaveCount(0);
  await expect(page.locator('#depth-target')).toBeVisible();
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

for (const precommit of [false, true]) {
  test(`rejects a superseded navigation and finishes its replacement (precommit=${precommit})`, async ({ page }) => {
    if (!precommit) await emulateBrowserWithoutPrecommit(page);
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
}

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

for (const method of ['push', 'replace']) {
  test(`${method} updates the live URL before the payload arrives without precommit`, async ({ page }) => {
    await emulateBrowserWithoutPrecommit(page);
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route('**/profile/1?tab=activity', async (route) => {
      if (route.request().headers()['rsc'] !== '1') return route.fallback();
      await held;
      await route.continue();
    });
    try {
      await page.goto('/profile/1');
      await expect(page.locator('[data-nav="query-tab"]')).toHaveText('(none)');
      await startRouterCall(page, method, '?tab=activity');
      await expect(page).toHaveURL('/profile/1?tab=activity');
      await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
      await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
      expect((await routerResult(page)).state).toBe('waiting');
    } finally {
      release?.();
    }
    await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  });
}

test('existing url follows query, hash and Back without stale snapshots', async ({ page }) => {
  await page.goto('/profile/1');
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('(none)');
  await page.getByRole('button', { name: "push('?tab=activity')" }).click();
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('activity');
  await page.evaluate(() => {
    location.hash = 'posts';
  });
  await expect(page.locator('[data-nav="hash"]')).toHaveText('#posts');
  await page.evaluate(() => navigation.back());
  await expect(page.locator('[data-nav="hash"]')).toHaveText('(none)');
  await page.evaluate(() => navigation.back());
  await expect(page.locator('[data-nav="query-tab"]')).toHaveText('(none)');
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
    await startRouterCall(page, 'push', '/audit-loop');
    await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('rejected');
    await expect(page).toHaveURL('/profile/1');
    await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
    await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
    expect(externalRequests).toEqual([]);
  });
}

test('precommit falls back when the browser ignores its preparation handler', async ({ page }) => {
  await emulateBrowserWithoutPrecommit(page);
  await page.goto('/profile/1');
  await startRouterCall(page, 'push', '/users');
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
});

test('a digest redirect reports a document handoff before recovering the page', async ({ page }) => {
  await page.goto('/profile/1');
  await startRouterCall(page, 'push', '/dashboard');
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
  expect((await routerResult(page)).kind).toBe('document-navigation');
});

test('existing url follows a cross-page commit before its payload arrives', async ({ page }) => {
  await emulateBrowserWithoutPrecommit(page);
  await page.goto('/profile/1');
  await expect(page.locator('[data-nav="param-id"]')).toHaveText('1');
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('**/docs/getting-started', async (route) => {
    if (route.request().headers()['rsc'] !== '1') return route.fallback();
    await held;
    await route.continue();
  });
  try {
    await startRouterCall(page, 'push', '/docs/getting-started');
    await expect(page).toHaveURL('/docs/getting-started');
    await expect(page.locator('[data-nav="pathname"]')).toHaveText('/docs/getting-started');
    await expect(page.locator('[data-nav="param-id"]')).toHaveText('1');
    await expect(page.getByRole('heading', { name: /Ada Lovelace/ })).toBeVisible();
  } finally {
    release?.();
  }
  await expect.poll(() => routerResult(page).then((result) => result.state)).toBe('resolved');
  await expect(page.locator('[data-nav="param-id"]')).toHaveText('(none)');
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
