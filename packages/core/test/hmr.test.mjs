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

/*
 * Whether a position in what was built still points at the line that was written. Two of this framework's
 * own transforms touch the modules below — the page gets two exports appended (`rsvhono:pages`), and a client
 * component rendered on the server has `process` rebound (`rsvhono:env-shadow`) — and the page imports a
 * stylesheet, which the RSC plugin rewrites around. A map that survived all of that names the source line.
 */
describe('source maps', async () => {
  const { SourceMap } = await import('node:module');
  buildApp(APP_DIR, { env: ENV });

  /** 1-based line and 0-based column of `needle` in `text`. */
  function positionOf(text, needle) {
    const at = text.indexOf(needle);
    assert.notEqual(at, -1, `${JSON.stringify(needle)} is in the text`);
    const before = text.slice(0, at);
    return { line: before.split('\n').length, column: at - (before.lastIndexOf('\n') + 1) };
  }

  /** Where the server bundle's map says `needle` came from. */
  function originOf(dir, needle) {
    for (const file of readdirSync(dir, { recursive: true }).filter((name) => /\.m?js$/.test(name))) {
      const code = readFileSync(join(dir, file), 'utf8');
      if (!code.includes(needle) || !existsSync(join(dir, `${file}.map`))) continue;
      const map = new SourceMap(JSON.parse(readFileSync(join(dir, `${file}.map`), 'utf8')));
      const { line, column } = positionOf(code, needle);
      const entry = map.findEntry(line - 1, column);
      return { source: entry.originalSource, line: entry.originalLine + 1, file };
    }
    assert.fail(`no built file with a map contains ${JSON.stringify(needle)}`);
  }

  const sourceLine = (file, needle) => positionOf(readFileSync(join(APP_DIR, 'src', file), 'utf8'), needle).line;

  test('a page that imports a stylesheet and had exports appended still maps to its own lines', () => {
    // Near the top of the component and near the bottom: appended code must not have shifted either.
    for (const needle of ['vite app', 'item 7']) {
      const origin = originOf(join(APP_DIR, 'dist', 'server'), needle);
      assert.match(origin.source, /src\/pages\/home\.tsx$/, `${needle}: ${origin.source}`);
      assert.equal(origin.line, sourceLine('pages/home.tsx', needle), `${JSON.stringify(needle)} maps to the line it was written on`);
    }
  });

  test('a server function maps to its own line', () => {
    const origin = originOf(join(APP_DIR, 'dist', 'server'), 'fixture action failure');
    assert.match(origin.source, /src\/actions\.ts$/);
    assert.equal(origin.line, sourceLine('actions.ts', 'fixture action failure'));
  });

  test('a client component, as rendered on the server with its environment shadowed, maps to its own line', () => {
    const origin = originOf(join(APP_DIR, 'dist', 'server', 'ssr'), 'data-testid');
    assert.match(origin.source, /src\/components\/counter\.tsx$/);
    assert.equal(origin.line, sourceLine('components/counter.tsx', 'data-testid'));
  });

  test('the browser bundle ships no map at all', () => {
    const files = readdirSync(join(APP_DIR, 'dist', 'static'), { recursive: true });
    assert.deepEqual(
      files.filter((name) => name.endsWith('.map')),
      [],
      'that directory is public',
    );
    for (const name of files.filter((file) => file.endsWith('.js')))
      assert.doesNotMatch(readFileSync(join(APP_DIR, 'dist', 'static', name), 'utf8'), /sourceMappingURL/, name);
  });

  test('under dev, the module the browser is served carries a map back to the source file', async () => {
    const { child, base } = await startApp(APP_DIR, 'dev', { env: ENV });
    try {
      await (await fetch(`${base}/`)).text();
      const served = await (await fetch(`${base}/_static/src/components/counter.tsx`)).text();
      const inline = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/.exec(served);
      assert.ok(inline, 'an inline map, which is what DevTools reads');
      const payload = JSON.parse(Buffer.from(inline[1], 'base64').toString('utf8'));
      assert.ok(payload.sources.some((source) => /counter\.tsx$/.test(source)));
      const map = new SourceMap(payload);
      const { line, column } = positionOf(served, '"count"');
      const entry = map.findEntry(line - 1, column);
      assert.match(entry.originalSource, /counter\.tsx$/);
      assert.equal(entry.originalLine + 1, sourceLine('components/counter.tsx', 'data-testid="count"'));
    } finally {
      await stopServer(child);
    }
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
        // Not asserted: that the counter kept its value. A `'use server'` module a client component imports is
        // in both graphs, so its edit is a Fast Refresh of the importer *and* a re-read of the payload, and
        // which lands first decides whether the component keeps its state — about half the runs here reset it.
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
