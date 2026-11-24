// The Vite RSC path — `@rshono/core/vite` — against its own fixture, built and served by Vite itself.
//
// Every other suite here drives the Rspack build through the CLI. This one is the first slice of the
// migration off it (docs/vite-migration.md): the *same* runtime entries, compiled by `@vitejs/plugin-rsc`
// into Vite's three environments instead. So what is asserted is the contract those entries already keep
// under Rspack — one document per URL with the flight payload inlined, the `RSC: 1` variant, the Hono
// sub-app in front of pages, server functions by header and by form — and the few places where the bundler
// is the one answering: which server action ids exist, where a page's CSS comes from, what `process.env`
// a client component sees.
//
// A production build served by `vite preview`, then the dev server, then both in a real browser.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { actionFormData, FIXTURES_DIR, stopServer } from './helpers.mjs';

const APP_DIR = join(FIXTURES_DIR, 'vite-app');
const VITE = join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
const SECRET = 'fixture secret value';
const ENV = { ...process.env, FIXTURE_SECRET: SECRET, PUBLIC_FIXTURE: 'shown', NO_COLOR: '1' };
// The servers run the *app's* bundle, which carries a source map back to `dist/runtime/entry.rsc.js` — so
// under `test:coverage` their V8 coverage is attributed to framework files as a sliver of what the Rspack
// suites exercise, and drags the total under its threshold. The build keeps it: that is `dist/vite/index.js`.
// Set empty rather than left out: Node hands the variable down to a child that does not name it.
const SERVER_ENV = { ...ENV, NODE_V8_COVERAGE: '' };

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startVite(command) {
  const port = await freePort();
  const child = spawn(process.execPath, [VITE, command, '--port', String(port), '--strictPort'], {
    cwd: APP_DIR,
    env: SERVER_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`vite ${command} did not report ready within 60s:\n${output}`));
    }, 60_000);
    const onData = (chunk) => {
      output += chunk;
      if (/Local:\s+http:\/\/localhost:\d+/.test(output)) {
        clearTimeout(timer);
        resolve({ child, port, base: `http://localhost:${port}`, getOutput: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite ${command} exited early (${code}):\n${output}`));
    });
  });
}

/** Every file under `dir`, as text — what did, and did not, ship. */
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'));
}

/** A real browser, or `null` where none can be launched — the HTTP half of the suite does not need one. */
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
      const before = button.textContent;
      button.click();
      return button.textContent !== before || /[1-9]/.test(button.textContent);
    },
    null,
    { timeout: 30_000, polling: 200 },
  );
}

const build = spawnSync(process.execPath, [VITE, 'build'], { cwd: APP_DIR, env: ENV, encoding: 'utf8' });
assert.equal(build.status, 0, `vite build failed:\n${build.stdout}\n${build.stderr}`);

const browser = await launchBrowser();
after(() => browser?.close());
const browserSkip = browser ? false : 'no browser could be launched here';

test('the build bundles the installed react-server-dom-webpack, not the copy the plugin vendors', () => {
  // The plugin ships its own copy of the RSC runtime and falls back to it when it cannot find the package.
  // That copy tracks the newest React; this repo pins react, react-dom and react-server-dom-webpack to one
  // patch because the flight format couples them. A silent fallback would pair two different versions.
  const rscBundle = readFileSync(join(APP_DIR, 'dist', 'rsc', 'index.js'), 'utf8');
  assert.match(rscBundle, /node_modules\/react-server-dom-webpack\/cjs\/react-server-dom-webpack-server\.edge\.production\.js/);
  assert.doesNotMatch(rscBundle, /plugin-rsc\/dist\/vendor\/react-server-dom\/cjs\//);
});

describe('vite build, served by vite preview', async () => {
  const { base, child, getOutput } = await startVite('preview');
  after(() => stopServer(child));
  const origin = { origin: base };

  test('a page is one document: SSR markup, the flight payload inlined, one module entry', async () => {
    const res = await fetch(`${base}/?q=hello`, { headers: { cookie: 'probe=seen' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(res.headers.get('vary'), /\bRSC\b/);
    const html = await res.text();
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /data-page="home"/);
    assert.match(html, /__FLIGHT_DATA/, 'the same RSC evaluation is inlined for hydration');
    assert.match(html, /<script type="module" src="\/assets\/index-[\w-]+\.js"/, 'the client entry boots as a module');
    assert.match(html, /data-query="hello"/, 'the url prop carries the request query');
  });

  test('ctx reaches the page through the stylesheet wrapper', async () => {
    // The regression this fixture was built around: the page imports CSS, and the RSC plugin's own wrapper
    // for such a component re-creates the element from its enumerable props — dropping the non-enumerable
    // `ctx`. `rshono:pages` wraps pages itself. See `rshonoPages` in src/vite/index.ts.
    const html = await (await fetch(`${base}/`, { headers: { cookie: 'probe=seen' } })).text();
    assert.match(html, /data-ctx-cookie="seen"/);
    assert.match(html, /data-ctx-method="GET"/);
    assert.match(html, /<link rel="stylesheet"[^>]*href="\/assets\/home-[\w-]+\.css"/, 'and the stylesheet is still attached');
  });

  test('the same URL answers with the flight payload for RSC: 1', async () => {
    const res = await fetch(`${base}/`, { headers: { RSC: '1' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/x-component;charset=utf-8');
    assert.match(res.headers.get('vary'), /\bRSC\b/);
    const flight = await res.text();
    assert.match(flight, /"root":/);
    assert.match(flight, /RouterProvider/);
    assert.doesNotMatch(flight, /<!DOCTYPE/);
  });

  test('route params are typed strings on the page', async () => {
    const html = await (await fetch(`${base}/items/42`)).text();
    assert.match(html, /data-page="item" data-id="42"/);
  });

  test('a suspended subtree streams in after the shell', async () => {
    const html = await (await fetch(`${base}/slow`)).text();
    assert.match(html, /data-late="pending"/, 'the fallback is in the shell');
    assert.match(html, /data-late="arrived"/, 'and the content follows on the same response');
  });

  test('the Hono sub-app wraps pages and flight, and serves its own routes', async () => {
    assert.equal((await fetch(`${base}/`)).headers.get('x-fixture-middleware'), 'ran');
    assert.equal((await fetch(`${base}/`, { headers: { RSC: '1' } })).headers.get('x-fixture-middleware'), 'ran');
    assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { ok: true });
  });

  test('an endpoint route is plain HTTP', async () => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { healthy: true });
  });

  test('notFound() and an unmatched path both render the notFound page with a 404', async () => {
    for (const path of ['/gone', '/nothing-here']) {
      const res = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } });
      assert.equal(res.status, 404, path);
      assert.match(await res.text(), /data-page="not-found"/, path);
    }
  });

  test('redirect() before the shell is an HTTP redirect', async () => {
    const res = await fetch(`${base}/moved`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/items/1');
  });

  test("a 'use client' page is refused, by name", async () => {
    const res = await fetch(`${base}/client-page`);
    assert.equal(res.status, 500);
    assert.match(getOutput(), /page component for "\/client-page" is a client component/);
  });

  test('public/ is served', async () => {
    assert.equal((await (await fetch(`${base}/hello.txt`)).text()).trim(), 'public asset');
  });

  test('a client component sees only PUBLIC_ env on the server pass, and no secret ships', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /data-server-secret="present"/, 'the RSC environment is server code and reads the real environment');
    assert.match(html, /data-testid="env" data-public="shown" data-secret="\(unset\)"/, 'the SSR pass gets the browser’s view');
    assert.doesNotMatch(html, new RegExp(SECRET));
    for (const source of filesUnder(join(APP_DIR, 'dist', 'client'))) assert.doesNotMatch(source, new RegExp(SECRET));
    for (const source of filesUnder(join(APP_DIR, 'dist', 'ssr'))) assert.doesNotMatch(source, new RegExp(SECRET));
  });

  /** The built id of an export of src/actions.ts — the module key is whatever the form React rendered names. */
  async function actionId(name) {
    const html = await (await fetch(`${base}/`)).text();
    const key = html.match(/&quot;id&quot;:&quot;([^#&]+)#greet&quot;/)?.[1];
    assert.ok(key, 'the useActionState form names its action');
    return `${key}#${name}`;
  }

  test('a server function called from the client returns its value with the re-rendered page', async () => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { ...origin, RSC: '1', 'x-rsc-action': await actionId('shout'), 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(['quiet']),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/x-component;charset=utf-8');
    const flight = await res.text();
    assert.match(flight, /"returnValue":\{"ok":true,"value":"QUIET"\}/);
    assert.match(flight, /"root":/, 'the page is re-rendered in the same response');
  });

  test('a server function that throws answers 500 with the error as its result', async () => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { ...origin, RSC: '1', 'x-rsc-action': await actionId('fail'), 'content-type': 'text/plain;charset=UTF-8' },
      body: '[]',
    });
    assert.equal(res.status, 500);
    assert.match(await res.text(), /"returnValue":\{"ok":false/);
  });

  test('an unknown action id is a 400 — an unknown export of a known module included', async () => {
    for (const id of ['nope#nope', await actionId('notExported'), (await actionId('shout')).replace('#shout', '')]) {
      const res = await fetch(`${base}/`, {
        method: 'POST',
        headers: { ...origin, RSC: '1', 'x-rsc-action': id, 'content-type': 'text/plain;charset=UTF-8' },
        body: '[]',
      });
      assert.equal(res.status, 400, id);
      assert.match(await res.text(), /unknown server action/, id);
    }
  });

  test('a form posts to its action with no JavaScript, and the state comes back in the document', async () => {
    const html = await (await fetch(`${base}/`)).text();
    const res = await fetch(`${base}/`, { method: 'POST', headers: origin, body: actionFormData(html, { name: 'node' }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(await res.text(), /data-testid="greeting">hello node #\d+</);
  });

  test('in a browser: hydrates, calls actions, navigates softly and goes back', { skip: browserSkip }, async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const flightRequests = [];
    page.on('request', (request) => {
      if (request.headers().rsc === '1') flightRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    try {
      await page.goto(`${base}/`);
      await waitForHydration(page);
      const clicks = await page.textContent('[data-testid=count]');
      assert.equal(await page.$eval('h1', (el) => getComputedStyle(el).color), 'rgb(0, 128, 0)', 'the page stylesheet applies');

      await page.click('[data-testid=shout]');
      await page.waitForFunction(() => document.querySelector('[data-testid=shouted]').textContent === 'QUIET');
      assert.equal(await page.textContent('[data-testid=count]'), clicks, 'client state survives the action’s re-render');

      await page.click('[data-testid=greet]');
      await page.waitForFunction(() => document.querySelector('[data-testid=greeting]').textContent.startsWith('hello vite #'));

      await page.evaluate(() => {
        window.__sameDocument = true;
      });
      await page.click('a[href="/items/7"]');
      await page.waitForSelector('[data-page=item][data-id="7"]');
      assert.equal(new URL(page.url()).pathname, '/items/7');
      await page.goBack();
      await page.waitForSelector('[data-page=home]');
      assert.equal(await page.evaluate(() => window.__sameDocument), true, 'a plain anchor and back are soft navigations');

      assert.deepEqual(flightRequests, ['POST /', 'POST /', 'GET /items/7', 'GET /']);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});

describe('vite dev', async () => {
  const { base, child } = await startVite('dev');
  after(() => stopServer(child));

  test('the dev server renders the same document', async () => {
    const res = await fetch(`${base}/`, { headers: { cookie: 'probe=seen' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data-page="home"/);
    assert.match(html, /data-ctx-cookie="seen"/);
    assert.match(html, /__FLIGHT_DATA/);
    assert.match(html, /data-testid="env" data-public="shown" data-secret="\(unset\)"/);
    assert.equal(res.headers.get('x-fixture-middleware'), 'ran');
  });

  test('an action id is only ever an export of a "use server" module', async () => {
    // The dev server has no list of server references to check against — it finds a `'use server'` module
    // when it transforms it — so an id here is a path the client chose. A page module, a file outside the
    // app and a module that does not exist must all be refused before anything is called.
    for (const id of ['/src/pages/home.tsx#default', '/src/health.ts#handler', '/etc/passwd#x', '/src/missing.ts#x', '/src/actions.ts#notExported']) {
      const res = await fetch(`${base}/`, {
        method: 'POST',
        headers: { origin: base, RSC: '1', 'x-rsc-action': id, 'content-type': 'text/plain;charset=UTF-8' },
        body: '[]',
      });
      assert.equal(res.status, 400, id);
    }
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { origin: base, RSC: '1', 'x-rsc-action': '/src/actions.ts#shout', 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(['dev']),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /"value":"DEV"/);
  });

  test('in a browser: a server edit re-renders and a client edit hot-swaps, both keeping state', { skip: browserSkip }, async () => {
    const homeFile = join(APP_DIR, 'src', 'pages', 'home.tsx');
    const counterFile = join(APP_DIR, 'src', 'components', 'counter.tsx');
    const homeSource = readFileSync(homeFile, 'utf8');
    const counterSource = readFileSync(counterFile, 'utf8');
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/`);
      await waitForHydration(page);
      const clicks = (await page.textContent('[data-testid=count]')).replace('count: ', '');
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
    } finally {
      writeFileSync(homeFile, homeSource);
      writeFileSync(counterFile, counterSource);
      await page.close();
    }
  });
});
