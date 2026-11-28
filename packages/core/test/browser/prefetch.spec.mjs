import { expect, test } from '@playwright/test';
import { isPayloadGet } from './payload-holds.mjs';

/*
 * Fetching a page's payload ahead of the navigation to it: `data-prefetch` on a link, or `router.prefetch()`.
 * The payload is an ordinary PageResource that no navigation owns yet — so until one takes it over, nothing a
 * visitor can see has happened.
 */

function countPayloadGets(page, pathname) {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (isPayloadGet(request, pathname)) seen.count++;
  });
  return seen;
}

async function open(page) {
  await page.goto('/transition-probe');
  await page.locator('[data-probe-panel]').waitFor();
  await page.waitForLoadState('networkidle');
}

const link = (page, name) => page.locator(`[data-probe-go="${name}"]`);

test('hovering a prefetch link fetches the payload and changes nothing else', async ({ page }) => {
  await open(page);
  const gets = countPayloadGets(page, '/users');
  // The layout shows `router.pending`. Every value it takes from here on is recorded.
  await page.evaluate(() => {
    window.__pendingSeen = [];
    const shown = document.querySelector('[data-nav="pending"]');
    new MutationObserver(() => window.__pendingSeen.push(shown.textContent)).observe(shown, { childList: true, characterData: true, subtree: true });
  });

  await link(page, 'prefetched').hover();
  await expect.poll(() => gets.count).toBe(1);
  await page.waitForTimeout(300);

  await expect(page).toHaveURL('/transition-probe');
  await expect(page.getByRole('heading', { level: 1, name: 'Transition probe' })).toBeVisible();
  await expect(page.locator('[data-nav="pending"]')).toHaveText('no');
  expect(await page.evaluate(() => window.__pendingSeen)).toEqual([]);
  // Hovering again, and focusing, asks for nothing more: it is already on its way.
  await link(page, 'fast').hover();
  await link(page, 'prefetched').hover();
  await link(page, 'prefetched').focus();
  await page.waitForTimeout(200);
  expect(gets.count).toBe(1);
});

test('the click that follows uses the payload already fetched, and commits', async ({ page }) => {
  await open(page);
  const gets = countPayloadGets(page, '/users');
  await link(page, 'prefetched').hover();
  await expect.poll(() => gets.count).toBe(1);

  await link(page, 'prefetched').click();

  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await expect(page).toHaveURL('/users');
  expect(gets.count).toBe(1);
});

test('a click while the fetch ahead is still on the wire does not fetch twice', async ({ page }) => {
  await open(page);
  const gets = countPayloadGets(page, '/users');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/users', async (route) => {
    if (!isPayloadGet(route.request(), '/users')) return route.fallback();
    await held;
    await route.fallback();
  });
  try {
    await link(page, 'prefetched').hover();
    await expect.poll(() => gets.count).toBe(1);
    await link(page, 'prefetched').click();
    await page.waitForTimeout(200);
    release();
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    expect(gets.count).toBe(1);
  } finally {
    release();
  }
});

test('a redirect in a payload fetched ahead is followed only when a navigation takes it over', async ({ page }) => {
  await open(page);
  const gets = countPayloadGets(page, '/canonical');
  await link(page, 'prefetched-redirect').hover();
  await expect.poll(() => gets.count).toBe(1);
  await page.waitForTimeout(400);
  // Fetched, and it says "go to ?v=new". Nobody navigated, so nobody goes.
  await expect(page).toHaveURL('/transition-probe');

  await link(page, 'prefetched-redirect').click();
  await expect(page.locator('[data-canonical]')).toHaveText('Canonical new');
  await expect(page).toHaveURL('/canonical?v=new');
});

test('a server function throws away what was fetched ahead, so the navigation after it fetches again', async ({ page }) => {
  await open(page);
  const gets = countPayloadGets(page, '/users');
  await link(page, 'prefetched').hover();
  await expect.poll(() => gets.count).toBe(1);

  // A mutation: whatever was fetched before it may not show it.
  await page.locator('[data-probe-do="action"]').click();
  await expect(page.locator('[data-probe="action-pending"]')).toHaveText('false');

  await page.evaluate(() => navigation.navigate('/users').finished);
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  expect(gets.count).toBe(2);
});

test('fetching ahead does not disturb a payload the screen is still reading', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  await page.evaluate(() => navigation.navigate('/slow-stream').finished);
  await expect(page.locator('[data-slow-stream-loading]')).toBeVisible();

  // More fetches ahead than are kept: the oldest are dropped, which aborts *them* and nothing else.
  await page.evaluate(() => {
    for (const path of ['/users', '/boundary', '/login', '/canonical', '/reachability', '/action-race']) {
      const anchor = Object.assign(document.createElement('a'), { href: path });
      anchor.dataset.prefetch = '';
      document.body.append(anchor);
      anchor.dispatchEvent(new PointerEvent('pointerenter'));
    }
  });

  await expect(page.locator('[data-slow-stream-content]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a link without data-prefetch fetches nothing until it is clicked', async ({ page }) => {
  await open(page);
  const gets = countPayloadGets(page, '/transition-probe');
  await link(page, 'fast').hover();
  await page.waitForTimeout(300);
  expect(gets.count).toBe(0);
  await link(page, 'fast').click();
  await expect(page.locator('[data-probe-visit*="visit=fast"]')).toBeVisible();
  expect(gets.count).toBe(1);
});

/*
 * Which links are worth fetching ahead for: exactly the ones a click on would soft-navigate. A payload for a
 * link the browser is going to handle itself — a download, another tab, a file, a jump within this page — is
 * a request nobody reads.
 */
test.describe('what is not fetched ahead', () => {
  /** Adds one `data-prefetch` anchor with `attributes`, shows intent on it, and reports the payload GETs it caused. */
  async function intentOn(page, href, attributes = {}) {
    const requests = [];
    const onRequest = (request) => {
      if (request.method() === 'GET' && request.headers().rsc === '1') requests.push(new URL(request.url()).pathname + new URL(request.url()).search);
    };
    page.on('request', onRequest);
    await page.evaluate(
      ([to, extra]) => {
        const anchor = document.createElement('a');
        anchor.setAttribute('href', to);
        anchor.dataset.prefetch = '';
        for (const [name, value] of Object.entries(extra)) anchor.setAttribute(name, value);
        document.body.append(anchor);
        for (const type of ['pointerenter', 'focusin', 'touchstart']) anchor.dispatchEvent(new Event(type, { bubbles: type === 'focusin' }));
      },
      [href, attributes],
    );
    await page.waitForTimeout(300);
    page.off('request', onRequest);
    return requests;
  }

  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  for (const [name, href, attributes] of [
    ['a link marked data-native', '/users', { 'data-native': '' }],
    ['a download link', '/users', { download: '' }],
    ['a link that opens another browsing context', '/users', { target: '_blank' }],
    ['a link into a named frame', '/users', { target: 'sidebar' }],
    ['a link to a file', '/favicon.svg', {}],
    ['a link to a file with a query', '/llms.txt?v=2', {}],
    ['a link to another origin', 'https://example.com/users', {}],
    ['a link that is not http at all', 'mailto:someone@example.com', {}],
    ['a link to the page already on screen', '/transition-probe', {}],
    ['a link that differs from this page only by its fragment', '/transition-probe#section', {}],
    ['a bare fragment', '#section', {}],
  ]) {
    test(`${name} fetches nothing`, async ({ page }) => {
      expect(await intentOn(page, href, attributes)).toEqual([]);
      await expect(page).toHaveURL('/transition-probe');
    });
  }

  test('target="_self" is this browsing context, and is fetched', async ({ page }) => {
    expect(await intentOn(page, '/users', { target: '_self' })).toEqual(['/users']);
  });

  test('the same page with another query is another page, and is fetched', async ({ page }) => {
    expect(await intentOn(page, '/transition-probe?visit=ahead')).toEqual(['/transition-probe?visit=ahead']);
  });

  test('router.prefetch() takes the caller at its word about the page on screen, and still refuses what cannot be soft-navigated', async ({
    page,
  }) => {
    const requests = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.headers().rsc === '1') requests.push(new URL(request.url()).pathname);
    });
    const router = (href) => page.evaluate((to) => document.querySelector('[data-nav-router]').router.prefetch(to), href);
    await router('/favicon.svg');
    await router('https://example.com/users');
    await page.waitForTimeout(300);
    expect(requests, 'a file and another origin have no payload to fetch').toEqual([]);
    await router('/transition-probe');
    await expect.poll(() => requests).toEqual(['/transition-probe']);
  });
});
