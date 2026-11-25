// What an app hands to its toolchain *through* the framework: `react` options for the one React plugin the
// framework registers, and plugins in `vite.plugins`. Until here the suite checked only that the options
// arrive (unit.test.mjs); this builds one source three ways and reads what came out.
//
// Whether the compiled component *behaves* differently is a browser question — test/browser/toolchain.spec.mjs.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { buildApp, startApp, stopServer, TOOLCHAIN_APP_DIR } from './helpers.mjs';

const CACHE = 'react.memo_cache_sentinel';
const MARKERS = ['alpha', 'beta', 'gamma', 'delta'].map((name) => `icon-marker-${name}`);

/** Every `.js` under `dir`, name → source. */
function scripts(dir) {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => [file, readFileSync(join(dir, file), 'utf8')]),
  );
}

/** Builds the fixture with `env` and returns what the three questions below are asked of. */
function build(env) {
  const output = buildApp(TOOLCHAIN_APP_DIR, { env });
  const client = scripts(join(TOOLCHAIN_APP_DIR, 'dist', 'static', 'assets'));
  const ssr = scripts(join(TOOLCHAIN_APP_DIR, 'dist', 'server', 'ssr', 'assets'));
  // The chunk the `Board` client component landed in, on each side.
  const board = (files) => Object.values(files).find((source) => source.includes('data-expensive'));
  return { output, client, clientBoard: board(client), ssrBoard: board(ssr), clientBytes: Object.values(client).reduce((n, s) => n + s.length, 0) };
}

async function served(env) {
  const { base, child } = await startApp(TOOLCHAIN_APP_DIR, 'start', { env });
  try {
    const res = await fetch(`${base}/`);
    return { status: res.status, html: await res.text() };
  } finally {
    await stopServer(child);
  }
}

describe('the fixture as written', () => {
  const plain = build({});

  test('the client component is not compiled', () => {
    assert.ok(plain.clientBoard, 'the component has a chunk');
    assert.doesNotMatch(plain.clientBoard, /memo_cache_sentinel/);
    assert.doesNotMatch(plain.ssrBoard, /memo_cache_sentinel/);
  });

  test('one name from the barrel ships all four modules', () => {
    for (const marker of MARKERS) assert.ok(plain.clientBoard.includes(marker), `${marker} is in the browser bundle`);
  });

  test('and it serves', async () => {
    const { status, html } = await served({});
    assert.equal(status, 200);
    assert.match(html, /data-board[^>]*data-icon="alpha"/);
    assert.match(html, /<ul data-expensive="true"><li>a<\/li><li>b<\/li><li>c<\/li><\/ul>/);
  });
});

describe('react: { compiler: true }', () => {
  const env = { FIXTURE_COMPILER: '1' };
  const compiled = build(env);

  test('the client component is compiled for the browser', () => {
    assert.ok(compiled.clientBoard.includes(CACHE), 'the chunk reads the memo cache the compiler allocates');
  });

  test('the server render of it is left as written', () => {
    // `@vitejs/plugin-react` compiles for the client environment only: memoising a render that happens once
    // buys nothing. So the two sides run different code for one component — and what makes that safe is
    // that the compiler changes when a component re-renders, never what it renders. The browser spec loads
    // this build and asserts it hydrates without a mismatch.
    assert.doesNotMatch(compiled.ssrBoard, /memo_cache_sentinel/);
  });

  test('the build says nothing about it', () => {
    assert.doesNotMatch(compiled.output, /compiler/i, 'no diagnostic for a component the compiler accepts');
  });

  test('the compiled page renders the same document', async () => {
    const { status, html } = await served(env);
    assert.equal(status, 200);
    assert.match(html, /data-board[^>]*data-icon="alpha"/);
    assert.match(html, /<ul data-expensive="true"><li>a<\/li><li>b<\/li><li>c<\/li><\/ul>/);
    assert.match(html, /__FLIGHT_DATA/, 'and still hydrates');
  });

  test('under `rsvhono dev` the module the browser is served is compiled too', async () => {
    const { base, child } = await startApp(TOOLCHAIN_APP_DIR, 'dev', { env });
    try {
      const page = await fetch(`${base}/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /data-board/);
      const module = await (await fetch(`${base}/_static/src/components/board.tsx`)).text();
      assert.match(module, /compiler-runtime|compilerRuntime/, 'the dev transform went through the compiler');
      assert.match(module, /\$RefreshSig\$|createHotContext/, 'and Fast Refresh is still wired into the same module');
    } finally {
      await stopServer(child);
    }
  });
});

describe('a Rolldown plugin in vite.plugins', () => {
  const env = { FIXTURE_TRANSFORM_IMPORTS: '1' };
  const plain = build({});
  const transformed = build(env);

  test('the barrel import is rewritten, and only the module asked for ships', () => {
    assert.ok(transformed.clientBoard.includes('icon-marker-alpha'));
    for (const marker of MARKERS.slice(1)) assert.ok(!transformed.clientBoard.includes(marker), `${marker} was left out`);
  });

  test('it applies to the server render of the client component as well', () => {
    assert.ok(transformed.ssrBoard.includes('icon-marker-alpha'));
    for (const marker of MARKERS.slice(1)) assert.ok(!transformed.ssrBoard.includes(marker), `${marker} is not in the SSR bundle either`);
  });

  test('the browser bundle is smaller for it', () => {
    assert.ok(transformed.clientBytes < plain.clientBytes, `${transformed.clientBytes} bytes against ${plain.clientBytes}`);
  });

  test('and the page is the same page', async () => {
    const { status, html } = await served(env);
    assert.equal(status, 200);
    assert.match(html, /data-board[^>]*data-icon="alpha"/);
  });
});

describe('both together', () => {
  const env = { FIXTURE_COMPILER: '1', FIXTURE_TRANSFORM_IMPORTS: '1' };
  const both = build(env);

  test('neither undoes the other', () => {
    assert.ok(both.clientBoard.includes(CACHE));
    assert.ok(both.clientBoard.includes('icon-marker-alpha'));
    assert.ok(!both.clientBoard.includes('icon-marker-beta'));
  });
});
