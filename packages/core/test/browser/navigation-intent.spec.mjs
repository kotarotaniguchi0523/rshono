import { expect, test } from '@playwright/test';
import { holdNextPayload, unique } from './payload-holds.mjs';

/*
 * A `redirect()` or `notFound()` raised late — from inside a `<Suspense>`, after the shell — by a page the
 * visitor is already leaving. The page is still on screen and React is still rendering it, so the signal
 * arrives; what it may no longer do is decide where the visitor goes.
 *
 * `/gated-intent?gate=<id>&to=<path>` raises its signal when `POST /api/gate?id=<id>` says so.
 */

/** From the page, so the POST carries its origin and passes the same check a form would. */
async function openGate(page, id) {
  const opened = await page.evaluate((gate) => fetch(`/api/gate?id=${gate}`, { method: 'POST' }).then((response) => response.ok), id);
  expect(opened, 'the gate endpoint must have answered').toBe(true);
}

/** Records every URL the tab shows from here on, document loads included. */
function watchUrls(page) {
  const urls = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(new URL(frame.url()).pathname + new URL(frame.url()).search);
  });
  return urls;
}

async function openGatedPage(page, query) {
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();
  // A soft navigation, so the page is shown from a flight payload — the kind a navigation can supersede.
  await page.evaluate((href) => navigation.navigate(href).finished, `/gated-intent?${query}`);
  await expect(page.locator('[data-gated="waiting"]')).toBeVisible();
}

for (const phase of ['precommit', 'post-commit']) {
  for (const signal of ['redirect', 'notfound']) {
    test(`a late ${signal} from the page being left does not take over a ${phase} navigation`, async ({ page }) => {
      // Without the precommit phase the browser commits the URL first and the fetch happens after.
      if (phase === 'post-commit') await page.addInitScript(() => delete globalThis.NavigationPrecommitController);
      const id = unique('left');
      await openGatedPage(page, `gate=${id}&to=/login${signal === 'notfound' ? '&signal=notfound' : ''}`);
      const urls = watchUrls(page);
      const hold = await holdNextPayload(page, '/users');

      try {
        // The visitor asks for /users, and its payload is kept waiting.
        await page.locator('[data-gated-go]').click();
        await hold.snapshotTaken;
        // Now the page being left raises its signal.
        await openGate(page, id);
        // Long enough for the digest to have reached React and for anything it started to show.
        await page.waitForTimeout(500);

        hold.release();
        await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
        await expect(page).toHaveURL('/users');
      } finally {
        hold.release();
      }
      // Never the redirect's target, and never back to the page that raised the signal.
      expect(urls.filter((url) => url.startsWith('/login'))).toEqual([]);
      expect(urls.filter((url) => url.startsWith('/gated-intent'))).toEqual([]);
      await expect(page.locator('[data-rsvhono-fatal]')).toHaveCount(0);
    });
  }
}

test('a late redirect from the page on screen, with nothing else going on, is followed once and replaces the entry', async ({ page }) => {
  const id = unique('own');
  await openGatedPage(page, `gate=${id}&to=/login`);
  const urls = watchUrls(page);

  await openGate(page, id);
  await expect(page).toHaveURL('/login');
  await expect(page.locator('input[name="email"]')).toBeVisible();
  // Once: React reports the signal at every boundary it passes, and each report is the same intent.
  expect(urls.filter((url) => url.startsWith('/login'))).toHaveLength(1);

  // Replaced, not pushed: Back leaves the redirecting page out and lands where the visitor came from.
  await page.goBack();
  await expect(page).toHaveURL('/');
});

test('A → B → A: the first visit’s late redirect does nothing to the second visit', async ({ page }) => {
  const first = unique('first');
  const second = unique('second');
  await openGatedPage(page, `gate=${first}&to=/login`);

  await page.evaluate(() => navigation.navigate('/users').finished);
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  // The same page again, as a different visit with a gate of its own.
  await page.evaluate((href) => navigation.navigate(href).finished, `/gated-intent?gate=${second}&to=/dashboard`);
  await expect(page.locator('[data-gated="waiting"]')).toBeVisible();
  const urls = watchUrls(page);

  // The first visit's render is still parked on the server. Its signal has no page left to arrive in.
  await openGate(page, first);
  await page.waitForTimeout(700);
  await expect(page.locator('[data-gated="waiting"]')).toBeVisible();
  expect(urls).toEqual([]);

  // The second visit's own signal still works.
  await openGate(page, second);
  await expect(page).toHaveURL(/\/(dashboard|login)/);
});

test('a page that asks for two different redirects is sent to the first', async ({ page }) => {
  const one = unique('one');
  const two = unique('two');
  await openGatedPage(page, `gate=${one}&to=/users&gate2=${two}&to2=/login`);
  const urls = watchUrls(page);

  // The second section's gate opens too, a moment later: whichever the render reaches first is the answer,
  // and the other one — and every boundary the abort then closes — repeats it rather than competing.
  await openGate(page, one);
  await openGate(page, two);
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(urls.filter((url) => url.startsWith('/login'))).toEqual([]);
  await expect(page).toHaveURL('/users');
});
