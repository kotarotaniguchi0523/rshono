// What only a real browser on a real dev server can show: an edit arriving in the page without a reload.
//
// And, on the same small fixture, the two things about the build that the testbed's size hides: that a page
// importing a stylesheet still gets its `ctx`, and which copy of the RSC runtime ends up in the bundle.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { buildApp, FIXTURES_DIR, startApp, stopServer } from './helpers.mjs';

const APP_DIR = join(FIXTURES_DIR, 'hmr-app');
const ENV = { FIXTURE_SECRET: 'fixture secret value', PUBLIC_FIXTURE: 'shown' };

/** A real browser, or `null` where none can be launched. */
async function launchBrowser() {
  try {
    const { chromium } = await import('@playwright/test');
    const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
    try {
      return await chromium.launch();
    } catch (error) {
      if (!systemChrome) throw error;
      return await chromium.launch({ executablePath: systemChrome, args: ['--no-sandbox'] });
    }
  } catch {
    return null;
  }
}

/** Clicks the counter until a click lands — which is the moment the page has hydrated. */
async function waitForHydration(page) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector('[data-testid=count]');
      button.click();
      return /[1-9]/.test(button.textContent);
    },
    null,
    { timeout: 30_000, polling: 200 },
  );
}

describe('a production build', async () => {
  buildApp(APP_DIR, { env: ENV });
  const { child, base } = await startApp(APP_DIR, 'start', { env: ENV });
  after(() => stopServer(child));

  test('ctx reaches a page that imports a stylesheet', async () => {
    // The RSC plugin wraps a server component whose module imports CSS, and re-creates the element from its
    // enumerable props — which drops the non-enumerable `ctx`. Pages are wrapped by `rsvhono:pages` instead.
    const html = await (await fetch(`${base}/?q=hello`, { headers: { cookie: 'probe=seen' } })).text();
    assert.match(html, /data-ctx-cookie="seen"/);
    assert.match(html, /data-ctx-method="GET"/);
    assert.match(html, /data-query="hello"/);
    assert.match(html, /<link rel="stylesheet"[^>]*href="\/_static\/assets\/[\w-]+\.css"/, 'and the stylesheet is still attached');
  });

  test('a client component is rendered against the public environment on the server too', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /data-server-secret="present"/, 'the RSC environment is server code and reads the real environment');
    assert.match(html, /data-testid="env" data-public="shown" data-secret="\(unset\)"/);
  });

  test('the bundle carries the installed react-server-dom-webpack, not the copy the plugin vendors', () => {
    // The plugin ships its own copy of the RSC runtime and falls back to it when it cannot find the package.
    // That copy tracks the newest React; this repo pins react, react-dom and react-server-dom-webpack to one
    // patch because the flight format couples them. A silent fallback would pair two different versions.
    const serverDir = join(APP_DIR, 'dist', 'server');
    const sources = readdirSync(serverDir, { recursive: true })
      .filter((file) => file.endsWith('.map'))
      .flatMap((file) => JSON.parse(readFileSync(join(serverDir, file), 'utf8')).sources);
    assert.ok(sources.some((source) => /node_modules\/react-server-dom-webpack\/server\.\w+\.js$/.test(source)));
    assert.deepEqual(
      sources.filter((source) => /plugin-rsc\/dist\/vendor\/react-server-dom\/cjs\//.test(source)),
      [],
    );
  });
});

describe('rsvhono dev', async () => {
  const { child, base } = await startApp(APP_DIR, 'dev', { env: ENV });
  after(() => stopServer(child));
  const browser = await launchBrowser();
  after(() => browser?.close());

  test(
    'a server edit re-renders and a client edit hot-swaps, both keeping state',
    { skip: browser ? false : 'no browser could be launched here' },
    async () => {
      const homeFile = join(APP_DIR, 'src', 'pages', 'home.tsx');
      const counterFile = join(APP_DIR, 'src', 'components', 'counter.tsx');
      const homeSource = readFileSync(homeFile, 'utf8');
      const counterSource = readFileSync(counterFile, 'utf8');
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${base}/`);
        await waitForHydration(page);
        const clicks = (await page.textContent('[data-testid=count]')).replace('count: ', '');
        assert.equal(await page.$eval('h1', (el) => getComputedStyle(el).color), 'rgb(0, 128, 0)', 'the page stylesheet applies');
        await page.evaluate(() => {
          window.__sameDocument = true;
        });

        writeFileSync(homeFile, homeSource.replace('Vite app\n', 'Vite app, edited\n'));
        await page.waitForFunction(() => document.querySelector('h1').textContent.includes('edited'), null, { timeout: 20_000 });
        assert.equal(await page.textContent('[data-testid=count]'), `count: ${clicks}`, 'a server component edit keeps client state');

        writeFileSync(counterFile, counterSource.replace('count: {count}', 'clicks: {count}'));
        await page.waitForFunction(() => document.querySelector('[data-testid=count]').textContent.startsWith('clicks'), null, { timeout: 20_000 });
        assert.equal(await page.textContent('[data-testid=count]'), `clicks: ${clicks}`, 'Fast Refresh keeps it too');
        assert.equal(await page.evaluate(() => window.__sameDocument), true, 'neither edit reloaded the document');
        assert.deepEqual(errors, []);
      } finally {
        writeFileSync(homeFile, homeSource);
        writeFileSync(counterFile, counterSource);
        await page.close();
      }
    },
  );
  test(
    'a stylesheet edit restyles the page, and a server function edit is what the next call runs',
    { skip: browser ? false : 'no browser could be launched here' },
    async () => {
      const cssFile = join(APP_DIR, 'src', 'pages', 'home.css');
      const actionsFile = join(APP_DIR, 'src', 'actions.ts');
      const cssSource = readFileSync(cssFile, 'utf8');
      const actionsSource = readFileSync(actionsFile, 'utf8');
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${base}/`);
        await waitForHydration(page);
        const count = await page.textContent('[data-testid=count]');
        await page.evaluate(() => {
          window.__sameDocument = true;
        });

        // The stylesheet belongs to a *server* component, so there is no client module to hot-swap it through.
        writeFileSync(cssFile, cssSource.replace('rgb(0, 128, 0)', 'rgb(0, 0, 255)'));
        await page.waitForFunction(() => getComputedStyle(document.querySelector('h1')).color === 'rgb(0, 0, 255)', null, { timeout: 20_000 });
        assert.equal(await page.textContent('[data-testid=count]'), count, 'restyling keeps client state');

        // Before the edit, the function as written.
        await page.click('[data-testid=shout]');
        await page.waitForFunction(() => document.querySelector('[data-testid=shouted]').textContent === 'QUIET');

        writeFileSync(actionsFile, actionsSource.replace('return text.toUpperCase();', 'return `${text.toUpperCase()}!`;'));
        // Nothing on screen changes for a server function edit, so there is nothing to wait on but the call.
        await page.waitForFunction(
          async () => {
            document.querySelector('[data-testid=shout]').click();
            await new Promise((resolve) => setTimeout(resolve, 300));
            return document.querySelector('[data-testid=shouted]').textContent === 'QUIET!';
          },
          null,
          { timeout: 20_000, polling: 500 },
        );
        assert.equal(await page.evaluate(() => window.__sameDocument), true, 'neither edit reloaded the document');
        assert.equal(await page.textContent('[data-testid=count]'), count, 'and the counter is where it was');
        assert.deepEqual(errors, []);
      } finally {
        writeFileSync(cssFile, cssSource);
        writeFileSync(actionsFile, actionsSource);
        await page.close();
      }
    },
  );

  test('a soft navigation is recorded on the rsvhono devtools track', { skip: browser ? false : 'no browser could be launched here' }, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/`);
      await waitForHydration(page);
      await page.click('a[href="/items/7"]');
      await page.waitForURL(`${base}/items/7`);
      const track = () =>
        page.evaluate(() =>
          performance
            .getEntriesByType('measure')
            .filter((entry) => entry.detail?.devtools?.track === 'rsvhono')
            .map((entry) => ({ name: entry.name, duration: entry.duration })),
        );
      await page.waitForFunction(() => performance.getEntriesByType('measure').some((entry) => entry.detail?.devtools?.track === 'rsvhono'), null, {
        timeout: 10_000,
      });
      const entries = await track();
      assert.ok(entries.length > 0, 'the dev build measures its own work');
      for (const entry of entries) assert.ok(entry.duration >= 0 && entry.name.length > 0, `${entry.name} is a real measure`);
    } finally {
      await page.close();
    }
  });
});
