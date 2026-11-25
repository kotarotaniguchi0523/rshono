import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
export const TESTBED_DIR = join(ROOT, 'apps', 'testbed');
export const TESTBED_DIST = join(TESTBED_DIR, 'dist');
export const FIXTURES_DIR = join(ROOT, 'packages', 'core', 'test', 'fixtures');
/** The smallest app the framework accepts: src/routes.ts and nothing else. */
export const MINIMAL_APP_DIR = join(FIXTURES_DIR, 'minimal-app');
/** An app whose CSS only compiles if the builder found its `postcss.config.mjs`. */
export const POSTCSS_APP_DIR = join(FIXTURES_DIR, 'postcss-app');
const CLI = join(ROOT, 'packages', 'core', 'bin', 'rsvhono.mjs');

/** What each command prints once it is listening; the capture group is the port. */
const READY = {
  start: /serving on http:\/\/localhost:(\d+)/,
  dev: /dev server: http:\/\/localhost:(\d+)/,
};

/**
 * The environment the testbed is built and served with. It lives here rather than in the testbed's
 * `.env`, because `.env*` is gitignored: a suite that asserts on these values has to carry them
 * itself or it passes locally and fails on a fresh checkout. The real environment wins over a
 * `.env` file, so this also pins the values against whatever a contributor happens to have there.
 */
export const APP_ENV = {
  /** Secret — asserted never to reach the browser, in the HTML, the flight payload or a chunk. */
  DATABASE_URL: 'my private database url',
  /** `PUBLIC_`-prefixed — asserted to be inlined into the client bundle and visible via `ctx.env`. */
  PUBLIC_API_ENDPOINT: 'public dummy url',
};

/**
 * Build any app directory with the real CLI, the way a user would. `config` is an absolute path to a
 * fixture config: config bakes into the bundle at build time, so exercising a non-default setting
 * (`trustProxy`) means building with one. The security middleware in the testbed's src/server.ts —
 * `csrf()`, `bodyLimit()`, `secureHeaders()` — is read from the environment at start instead, and
 * needs no build of its own.
 */
export function buildApp(dir, { config, args = [], env = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, 'build', ...(config ? ['--config', config] : []), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...APP_ENV, ...env },
    timeout: 180_000,
  });
  if (result.status !== 0) {
    throw new Error(`build failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  // Both streams, the way {@link runCli} returns them: a build says what it did on stdout and warns about it
  // on stderr, and a test asserting on what the build said wants the pair. Concatenated rather than
  // interleaved — which of them a line landed on is not what any of these assert.
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

export function buildTestbed(config, { env } = {}) {
  return buildApp(TESTBED_DIR, { config, env });
}

/**
 * Runs `rsvhono <args>` to completion — for asserting on a command that is expected to *exit*, where
 * {@link startApp} would only ever reject. Both streams are returned as one string, because which of
 * them a refusal lands on is not the point of any test that uses this.
 */
export function runCli(dir, args, { env = {}, timeoutMs = 60_000 } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...APP_ENV, ...env },
    timeout: timeoutMs,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * Imports the server bundle the last build produced, for a suite that calls its export the way a
 * platform would rather than over HTTP.
 *
 * `import()` resolves a *URL*, not a path, so the path has to be converted: on Windows an absolute
 * path starts with a drive letter, which parses as a `d:` scheme and Node rejects with
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME`. A bare path only gets away with it on POSIX, where it happens to
 * read as a URL path — so this lives here rather than at each call site.
 *
 * `cacheKey` is appended as a query. Every target builds to the same filename and the module cache
 * is keyed by specifier, so importing twice without one hands back the previous build.
 */
export function importServerBundle(cacheKey) {
  return importAppBundle(TESTBED_DIR, cacheKey);
}

/**
 * {@link importServerBundle} for any app directory — the fixtures included.
 *
 * Imported from a private copy of `dist/`, not from `dist/` itself. A build is `main.mjs` plus the chunks it
 * imports by relative path, and Node caches those by URL: a second build evaluated from the same directory
 * would get a fresh `main.mjs` wired to the *previous* build's chunks — two RSC runtimes sharing one React.
 * The copy sits inside the app so `node_modules` still resolves, and keeps the `dist/server` shape the
 * runtime finds its root by.
 */
export function importAppBundle(dir, cacheKey) {
  const copy = mkdtempSync(join(dir, `.bundle-${cacheKey ?? 'app'}-`));
  process.on('exit', () => rmSync(copy, { recursive: true, force: true }));
  cpSync(join(dir, 'dist'), join(copy, 'dist'), { recursive: true });
  return import(pathToFileURL(join(copy, 'dist', 'server', 'main.mjs')).href);
}

/** Runs `rsvhono <command>` in `dir` and resolves once it reports the address it is listening on. */
export function startApp(dir, command, { env = {}, timeoutMs = 60_000 } = {}) {
  const ready = READY[command];
  if (!ready) throw new Error(`no ready pattern for \`rsvhono ${command}\` — it would resolve on any output`);
  const child = spawn(process.execPath, [CLI, command], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: '0',
      ...APP_ENV,
      ...env,
      // The dev server runs the framework's own `dist/runtime/*.js` through Vite's module runner — the same
      // file URLs, but transformed code — so its V8 coverage maps to those files as noise. Set empty rather
      // than left out: Node hands the variable down to a child that does not name it.
      ...(command === 'dev' ? { NODE_V8_COVERAGE: '' } : null),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`server did not report ready within ${timeoutMs / 1000}s:\n${output}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk;
      const match = output.match(ready);
      if (match) {
        clearTimeout(timer);
        resolve({ child, port: Number(match[1]), base: `http://localhost:${match[1]}`, getOutput: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}):\n${output}`));
    });
  });
}

export function startTestbed(command, options) {
  return startApp(TESTBED_DIR, command, options);
}

export function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.on('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}

const CLIENT_ASSETS_DIR = join(TESTBED_DIST, 'static', 'assets');

/** The built browser bundle, file name → source. */
function clientScripts() {
  return new Map(
    readdirSync(CLIENT_ASSETS_DIR)
      .filter((file) => file.endsWith('.js'))
      .map((file) => [file, readFileSync(join(CLIENT_ASSETS_DIR, file), 'utf8')]),
  );
}

/** The built browser bundle's sources — the only way to assert what did, and did not, ship to it. */
export function clientChunks() {
  return [...clientScripts().values()];
}

/** `{o as a,i,n}` → `[['o', 'a'], ['i', 'i'], ['n', 'n']]`: each binding's name on the left of `as`, and on the right. */
function bindings(list) {
  return list
    .split(',')
    .map((entry) => entry.trim().split(/\s+as\s+/))
    .filter(([name]) => name)
    .map(([left, right = left]) => [left, right]);
}

/**
 * The id React assigned a server action, found the way the browser finds it: through the `'use client'`
 * component that calls it, identified by `marker` — a string only that component renders.
 *
 * The RSC plugin turns the app's action module into a chunk of `createServerReference("<key>#<name>")`
 * declarations, exported under minified names; the component's chunk imports the ones it uses. So: the
 * chunk holding the marker, its imports, and the first of those it actually calls.
 */
export function serverActionId(marker) {
  const scripts = clientScripts();
  for (const source of scripts.values()) {
    if (!source.includes(marker)) continue;

    let first = null;
    for (const [, imported, from] of source.matchAll(/import\{([^}]*)\}from"\.\/([^"]+)"/g)) {
      const proxy = scripts.get(from);
      if (!proxy) continue;
      // `n=t(\`1b65654b4e6a#createUser\`,…` — each declaration's local name and the id it carries.
      const idForLocal = new Map([...proxy.matchAll(/([\w$]+)=[\w$]+\(`([0-9a-f]+#[\w$]+)`/g)].map((m) => [m[1], m[2]]));
      if (idForLocal.size === 0) continue;
      const localForExport = new Map(bindings(proxy.match(/export\{([^}]*)\}/)?.[1] ?? '').map(([local, exported]) => [exported, local]));

      for (const [exported, local] of bindings(imported)) {
        const id = idForLocal.get(localForExport.get(exported));
        if (!id) continue;
        const call = new RegExp(`(?<![\\w$.])${local.replace(/\$/g, '\\$')}\\(`).exec(source);
        if (call && (first === null || call.index < first.index)) first = { id, index: call.index };
      }
    }
    if (first) return first.id;
  }
  throw new Error(
    `no client component rendering ${JSON.stringify(marker)} calls a server action. ` +
      'It has to *call* one — an action handed to `useActionState` is passed along as a value and never ' +
      'appears as a call site, so there is no mangled export name to trace back to an id.',
  );
}

/**
 * The body a browser would POST for a form React rendered, with no JavaScript involved. React emits
 * one of two field shapes: the `$ACTION_REF`/`$ACTION_KEY` set for a `useActionState` form, or a
 * single `$ACTION_ID_<id>` when a server component renders the form itself.
 */
export function actionFormData(html, fields = {}) {
  const form = new FormData();
  const hidden = (name) => {
    const match = html.match(new RegExp(`name="\\${name}" value="([^"]*)"`));
    return match ? match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&') : undefined;
  };

  const meta = hidden('$ACTION_1:0');
  const key = hidden('$ACTION_KEY');
  const id = html.match(/name="(\$ACTION_ID_[0-9a-f]+#\w+)"/)?.[1];
  if (meta && key) {
    form.set('$ACTION_REF_1', hidden('$ACTION_REF_1') ?? '');
    form.set('$ACTION_1:0', meta);
    form.set('$ACTION_1:1', hidden('$ACTION_1:1') ?? '[{}]');
    form.set('$ACTION_KEY', key);
  } else if (id) {
    form.set(id, '');
  } else {
    throw new Error('the rendered form carries no $ACTION fields, so it cannot be submitted');
  }

  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

/** Every hidden field of a server-rendered form, as a browser without JavaScript would post them. */
export function hiddenFields(html) {
  return Object.fromEntries(
    [...html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)].map(([, name, value = '']) => [
      name,
      value.replaceAll('&quot;', '"').replaceAll('&amp;', '&'),
    ]),
  );
}
