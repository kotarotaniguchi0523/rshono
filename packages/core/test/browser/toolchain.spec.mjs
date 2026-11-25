import { expect, test } from '@playwright/test';
import { buildApp, startApp, stopServer, TOOLCHAIN_APP_DIR } from '../helpers.mjs';

/*
 * React Compiler, turned on through `react: { compiler: true }`, judged by what it is for: a component that
 * re-renders for no reason stops doing so. The fixture's `Board` builds a new array every render and hands it
 * to `Expensive`; bumping the unrelated counter re-renders `Expensive` uncompiled and does not compiled.
 *
 * The fixture is built and served here, twice — it is a different app from the testbed the rest of this
 * directory runs against.
 */

test.describe.configure({ mode: 'serial' });

async function bumpThrice(page, base) {
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  const button = page.locator('[data-bump]');
  await expect(button).toHaveText('bumped 0');
  const afterHydration = await page.evaluate(() => globalThis.__expensiveRenders);
  for (let n = 1; n <= 3; n++) {
    await button.click();
    await expect(button).toHaveText(`bumped ${n}`);
  }
  const afterBumps = await page.evaluate(() => globalThis.__expensiveRenders);
  await expect(page.locator('[data-expensive] li')).toHaveText(['a', 'b', 'c']);
  return afterBumps - afterHydration;
}

for (const [name, env, expected] of [
  ['uncompiled, the child re-renders with every bump', {}, 3],
  ['compiled, the child does not re-render at all', { FIXTURE_COMPILER: '1' }, 0],
]) {
  test(name, async ({ page }) => {
    test.setTimeout(120_000);
    buildApp(TOOLCHAIN_APP_DIR, { env });
    const { base, child } = await startApp(TOOLCHAIN_APP_DIR, 'start', { env });
    try {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      expect(await bumpThrice(page, base)).toBe(expected);
      expect(errors, 'the compiled component hydrated without a mismatch').toEqual([]);
    } finally {
      await stopServer(child);
    }
  });
}
