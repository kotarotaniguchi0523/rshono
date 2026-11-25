import { expect, test } from '@playwright/test';

/*
 * Server functions against each other, against navigations, and against the re-read that repairs the screen
 * when a reply could not be shown. `/action-race` lists what the server has applied, in the order it applied
 * it; `window.__race(label, delayMs)` applies one more after a delay, so a test decides the server's order
 * independently of the order the calls were made in.
 *
 * The server's list is shared by every test in the run, so each one uses labels of its own and asserts on
 * those alone.
 */

const unique = (name) => `${name}-${crypto.randomUUID().slice(0, 8)}`;
const entry = (page, label) => page.locator(`[data-race-entry="${label}"]`);

/** Whether a request asks `pathname` for its flight payload — a navigation's fetch or a re-read, not an action. */
const isPayloadGet = (request, pathname) =>
  request.method() === 'GET' && request.headers()['rsc'] === '1' && new URL(request.url()).pathname === pathname;

/** Counts the payload fetches for `pathname` from here on. */
function countPayloadGets(page, pathname) {
  const seen = { count: 0 };
  page.on('request', (request) => {
    if (isPayloadGet(request, pathname)) seen.count++;
  });
  return seen;
}

async function openRace(page) {
  await page.goto('/action-race');
  await page.waitForFunction(() => document.documentElement.dataset.actionRaceReady === 'true');
}

/** Starts a call without waiting for it. Its result is kept on `window.__raceResults[label]`. */
const race = (page, label, delayMs) =>
  page.evaluate(
    ([name, delay]) => {
      window.__raceResults ??= {};
      window.__raceResults[name] = window.__race(name, delay).then(
        (value) => ({ value }),
        (error) => ({ error: String(error) }),
      );
    },
    [label, delayMs],
  );

const resultOf = (page, label) => page.evaluate((name) => window.__raceResults[name], label);

/**
 * Two overlapping calls whose server order is the reverse of their call order: the slow one is called first
 * and applied last. That ends in a re-read — neither reply can be trusted to be the newer snapshot.
 */
async function overlap(page, slow, fast) {
  await race(page, slow, 400);
  await race(page, fast, 0);
}

/**
 * Holds the next payload fetch for `pathname`: the server answers at once — so the snapshot is as old as the
 * moment it was asked for — and the browser is given the answer only when `release` is called.
 */
async function holdNextPayload(page, pathname) {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let fetched;
  const snapshotTaken = new Promise((resolve) => {
    fetched = resolve;
  });
  let used = false;
  await page.route(`**${pathname}`, async (route) => {
    if (used || !isPayloadGet(route.request(), pathname)) return route.fallback();
    used = true;
    const response = await route.fetch();
    const body = await response.body();
    fetched();
    await held;
    await route.fulfill({ response, body }).catch(() => {});
  });
  return { release, snapshotTaken };
}

test('calls made in one order and applied in the other both end up on screen', async ({ page }) => {
  await openRace(page);
  const slow = unique('slow-first');
  const fast = unique('fast-second');

  await overlap(page, slow, fast);

  // The fast reply is shown first and lists only itself; the slow reply is the older *call* and is not shown
  // over it — yet it is the newer *state*. Only reading the page again shows both.
  await expect(entry(page, fast)).toBeVisible();
  await expect(entry(page, slow)).toBeVisible();
  // Each caller still got its own return value, whichever reply reached the screen.
  expect(await resultOf(page, slow)).toEqual({ value: slow });
  expect(await resultOf(page, fast)).toEqual({ value: fast });
});

test('a re-read with no navigation in sight works every time, not only the first', async ({ page }) => {
  await openRace(page);
  const rereads = countPayloadGets(page, '/action-race');

  const first = [unique('round-1-slow'), unique('round-1-fast')];
  await overlap(page, ...first);
  await expect(entry(page, first[0])).toBeVisible();
  await expect.poll(() => rereads.count).toBe(1);

  // The second round is the point: a re-read that finished without ever waiting must not leave the next
  // one thinking it is still running.
  const second = [unique('round-2-slow'), unique('round-2-fast')];
  await overlap(page, ...second);
  await expect(entry(page, second[0])).toBeVisible();
  await expect(entry(page, second[1])).toBeVisible();
  await expect.poll(() => rereads.count).toBe(2);
});

test('a mutation completing during a re-read is not overwritten by that re-read', async ({ page }) => {
  await openRace(page);
  const rereads = countPayloadGets(page, '/action-race');
  const hold = await holdNextPayload(page, '/action-race');
  const before = [unique('before-slow'), unique('before-fast')];
  const during = unique('during');

  try {
    await overlap(page, ...before);
    // The re-read is on the wire, carrying a snapshot taken now.
    await hold.snapshotTaken;

    await race(page, during, 0);
    await expect(entry(page, during)).toBeVisible();
    expect(await resultOf(page, during)).toEqual({ value: during });

    // The held snapshot predates `during`. Shown, it would take the entry off the screen again.
    hold.release();
    await expect.poll(() => rereads.count).toBe(2);
    await expect(entry(page, during)).toBeVisible();
    await expect(entry(page, before[0])).toBeVisible();
    await expect(entry(page, before[1])).toBeVisible();
  } finally {
    hold.release();
  }
});

test('a navigation started during a re-read is not cancelled, and its destination is re-read', async ({ page }) => {
  await openRace(page);
  const destination = countPayloadGets(page, '/users');
  const hold = await holdNextPayload(page, '/action-race');

  try {
    await overlap(page, unique('nav-slow'), unique('nav-fast'));
    await hold.snapshotTaken;

    const finished = await page.evaluate(() =>
      navigation.navigate('/users').finished.then(
        () => 'resolved',
        (error) => `rejected: ${error.name}`,
      ),
    );
    expect(finished).toBe('resolved');
    await expect(page).toHaveURL('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();

    // The re-read was owed to a mutation, not to a URL: with the page it was fetching gone, it is owed to
    // the page the visitor is on now.
    await expect.poll(() => destination.count).toBe(2);
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  } finally {
    hold.release();
  }
});

test('A → B → A: a reply from the first visit changes nothing, and its caller still gets the result', async ({ page }) => {
  await openRace(page);
  const label = unique('first-visit');
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let applied;
  const serverApplied = new Promise((resolve) => {
    applied = resolve;
  });
  await page.route('**/action-race', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    const body = await response.body();
    applied();
    await held;
    await route.fulfill({ response, body });
  });

  try {
    await race(page, label, 0);
    await serverApplied;

    await page.evaluate(() => navigation.navigate('/users').finished);
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await page.evaluate(() => navigation.navigate('/action-race').finished);
    await expect(page).toHaveURL('/action-race');
    // Same URL as the call was made from, and a different visit to it.
    await expect(entry(page, label)).toHaveCount(1);

    const rereads = countPayloadGets(page, '/action-race');
    release();
    expect(await resultOf(page, label)).toEqual({ value: label });
    // Not shown — the URL matching is not the visit matching — and the page is read again instead.
    await expect.poll(() => rereads.count).toBe(1);
    await expect(page).toHaveURL('/action-race');
    await expect(entry(page, label)).toHaveCount(1);
  } finally {
    release?.();
  }
});

test('a payload still streaming keeps streaming while another is prepared, and stops quietly once replaced', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByText('(hydrated ✓)')).toBeVisible();

  // Committed with its stream open: the shell is on screen and the slow section is two seconds away. The
  // resource has gone from prepared to held.
  await page.evaluate(() => navigation.navigate('/slow-stream').finished);
  await expect(page.locator('[data-slow-stream-shell]')).toBeVisible();
  await expect(page.locator('[data-slow-stream-loading]')).toBeVisible();

  // A second resource is prepared and kept waiting. The first is still what the screen is reading.
  const hold = await holdNextPayload(page, '/users');
  try {
    await page.evaluate(() => void navigation.navigate('/users').finished.catch(() => {}));
    await hold.snapshotTaken;
    await expect(page.locator('[data-slow-stream-content]')).toBeVisible();
    await expect(page).toHaveURL('/slow-stream');

    hold.release();
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  } finally {
    hold.release();
  }

  // And the other way round: replaced while its stream is still open, the first resource is retired mid-flight.
  await page.evaluate(() => navigation.navigate('/slow-stream').finished);
  await expect(page.locator('[data-slow-stream-loading]')).toBeVisible();
  await page.evaluate(() => navigation.navigate('/users').finished);
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  // Past the moment the abandoned stream would have delivered its section.
  await page.waitForTimeout(2500);
  await expect(page.locator('[data-slow-stream-content]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
