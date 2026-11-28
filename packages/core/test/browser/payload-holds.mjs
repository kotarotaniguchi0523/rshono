/** Shared by the specs that race payloads against each other: naming a run's own data, and holding a fetch. */

export const unique = (name) => `${name}-${crypto.randomUUID().slice(0, 8)}`;

/** Whether a request asks `pathname` for its flight payload — a navigation's fetch or a re-read, not an action. */
export const isPayloadGet = (request, pathname) =>
  request.method() === 'GET' && request.headers()['rsc'] === '1' && new URL(request.url()).pathname === pathname;

/**
 * Holds the next payload fetch for `pathname`: the server answers at once — so the snapshot is as old as the
 * moment it was asked for — and the browser is given the answer only when `release` is called.
 */
export async function holdNextPayload(page, pathname) {
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
