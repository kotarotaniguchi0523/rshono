/**
 * The Vite config behind `rsvhono build` and `rsvhono dev`: the three runtime entries compiled by
 * `@vitejs/plugin-rsc` into its `rsc`, `ssr` and `client` environments, laid out as
 *
 *   dist/server/        the RSC environment — `main.mjs` is the entry `rsvhono start` and every platform loads
 *   dist/server/ssr/    the SSR environment, imported by the RSC one
 *   dist/static/        the client environment, served at `/_static/`
 */
import { getRequestListener } from '@hono/node-server';
import react from '@vitejs/plugin-react';
import rsc, { getPluginApi } from '@vitejs/plugin-rsc';
import { hasDirective, transformWrapExport } from '@vitejs/plugin-rsc/transforms';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import {
  isRunnableDevEnvironment,
  mergeConfig,
  parseAstAsync,
  type EnvironmentOptions,
  type InlineConfig,
  type Plugin,
  type ResolvedConfig,
} from 'vite';
import type { RsvhonoConfig } from '../config.js';
import type { DeployPreset } from '../deploy/presets.js';
import { PAGE_MARK } from '../runtime/validate-entries.js';
import { resolveServerConfig, type ServerConfig } from '../server/server-config.js';
import { readsGlobalProcess, shadowProcessEnv } from './env-shadow.js';
import { scanPageFiles } from './page-files.js';
import { publicEnv } from './public-env.js';
import { checkReactVersions } from './react-versions.js';

// This file lives in `dist/builder/`, so everything below is the *built* framework.
const FRAMEWORK_DIST = join(import.meta.dirname, '..');

const PACKAGE_NAME = '@rsvhono/core';

export const BUILD_OUT_DIR = 'dist';
/** Where the client build is served from — and, on the dev server, every module Vite serves. */
export const STATIC_BASE = '/_static/';

const SERVER_REFERENCES_ID = 'virtual:rsvhono/server-references';
const RESOLVED_SERVER_REFERENCES_ID = '\0' + SERVER_REFERENCES_ID;

export interface ViteConfigOptions {
  rootDir: string;
  isDev: boolean;
  config: RsvhonoConfig;
  preset: DeployPreset;
}

const frameworkFile = (...segments: string[]): string => join(FRAMEWORK_DIST, ...segments);

/**
 * Imports the browser bundle cannot have, and what to say about each. Without this the build still fails —
 * on `node:async_hooks`, three modules away from the line the author wrote.
 */
const SERVER_ONLY: Record<string, string> = {
  '@rsvhono/core/server': [
    'It is server-only by construction: `getRequestContext()` reads an AsyncLocalStorage store that exists only while a request is being handled.',
    "In a 'use client' component, read the URL and params with `useNavigation()` from '@rsvhono/core/client', navigate with the `router` it returns, and take anything else as a prop from the server component that renders this one.",
    "If this module was not meant to be a client component, the 'use client' directive at the top of it — or of a module it imports — is what put it in the browser bundle.",
  ].join('\n'),
};

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** Whether any source file under `srcDir` mentions `identifier` — a grep, which is all the warning below claims. */
function mentions(srcDir: string, identifier: string): boolean {
  try {
    for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) continue;
      if (readFileSync(join(entry.parentPath, entry.name), 'utf8').includes(identifier)) return true;
    }
  } catch {
    // Unreadable source is the build's to report, not this warning's.
  }
  return false;
}

/** A production build with no CSRF check or body cap says so: both are the app's to register, and easy to not know about. */
function warnAboutMissingSecurityMiddleware(srcDir: string, serverAppFile: string | undefined): void {
  if (!serverAppFile) {
    console.warn(
      '  ⚠ No src/server.ts — this build has no CSRF check and no request body cap. Both are Hono middleware\n' +
        '    (`csrf()`, `bodyLimit()`); `npx @rsvhono/create` scaffolds a src/server.ts with them registered.',
    );
  } else if (!mentions(srcDir, 'bodyLimit')) {
    console.warn(
      "  ⚠ No bodyLimit() anywhere in src/ — this build has no request body cap. Every 'use server' export is\n" +
        '    a public POST endpoint, and the action path buffers whatever arrives before it can reject it.\n' +
        '    Add `server.use(bodyLimit({ maxSize: 1024 * 1024 }))` to src/server.ts (from `hono/body-limit`).',
    );
  }
}

function firstExisting(dir: string, names: string[]): string | undefined {
  return names.map((name) => join(dir, name)).find(existsSync);
}

/** Appended to a page module by {@link rsvhonoPages}. `jsx(value, props)`, never `createElement` — see there. */
const WRAP_PAGE = `
import { jsx as __rsvhono_jsx, jsxs as __rsvhono_jsxs, Fragment as __rsvhono_Fragment } from "react/jsx-runtime";
function __rsvhono_wrap_page__(value, name) {
  if (typeof value !== "function") return value;
  function __wrapper(props) {
    return __rsvhono_jsxs(__rsvhono_Fragment, { children: [import.meta.viteRsc.loadCss(), __rsvhono_jsx(value, props)] });
  }
  Object.defineProperty(__wrapper, "name", { value: name });
  Object.defineProperty(__wrapper, ${JSON.stringify(PAGE_MARK)}, { value: true });
  return __wrapper;
}
`;

/**
 * Attaches a page's stylesheets to the page — for the modules `routes.ts` names with an inline `component: () => import('…')` thunk, plus
 * any that declare `'use server-entry'` themselves.
 *
 * `@vitejs/plugin-rsc` would do this by itself for a component whose module imports CSS, and it must not be
 * allowed to for a page: its wrapper re-creates the element with `createElement(Page, props)`, which copies
 * the *enumerable* props and so drops `ctx` — deliberately non-enumerable, see `pageProps` in
 * `runtime/entry.rsc.tsx`. The page would render with `ctx` undefined. So pages are taken out of the plugin's
 * transform (`rscCssTransform.filter` in {@link createViteConfig}) and wrapped here instead, passing the props object
 * through untouched. Registered ahead of the plugin so a hand-written directive is seen before its filter runs.
 */
function rsvhonoPages(pageFiles: Set<string>): Plugin {
  return {
    name: 'rsvhono:pages',
    async transform(code, id) {
      if (this.environment.name !== 'rsc') return;
      const file = id.split('?', 1)[0];
      if (!pageFiles.has(file) && !code.includes('use server-entry')) return;
      const ast = await parseAstAsync(code);
      // Left for `assertPageModule` to refuse, with a message about the page rather than about a wrapper.
      if (hasDirective(ast.body, 'use client')) return;
      if (!pageFiles.has(file)) {
        if (!hasDirective(ast.body, 'use server-entry')) return;
        pageFiles.add(file);
      }
      const { output } = transformWrapExport(code, ast, {
        runtime: (value, name, meta) => `__rsvhono_wrap_page__(${value}, ${JSON.stringify(meta.defaultExportIdentifierName ?? name)})`,
        filter: (name) => name === 'default',
        ignoreExportAllDeclaration: true,
      });
      if (!output.hasChanged()) return;
      output.append(WRAP_PAGE);
      return { code: output.toString(), map: output.generateMap({ hires: 'boundary' }) };
    },
  };
}

/** `@import 'pkg'` / `@import "pkg/file.css"` — a bare specifier, so not a relative path, an absolute one or a URL. */
const CSS_PACKAGE_IMPORT = /(@import\s+)(['"])((?:@[\w.-]+\/)?[\w][\w.-]*)((?:\/[^'"]*)?)\2/g;

/** The file a stylesheet means by `@import '<name><subpath>'`, the way a CSS toolchain reads a package. */
function resolveCssPackage(name: string, subpath: string, importer: string): string | undefined {
  try {
    const manifestFile = createRequire(importer).resolve(`${name}/package.json`);
    if (subpath) return join(dirname(manifestFile), subpath);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { style?: string; main?: string; exports?: Record<string, unknown> };
    const root = manifest.exports?.['.'];
    const style = (typeof root === 'object' && root !== null ? (root as { style?: unknown }).style : undefined) ?? manifest.style;
    const entry = typeof style === 'string' ? style : manifest.main?.endsWith('.css') ? manifest.main : undefined;
    return entry ? join(dirname(manifestFile), entry) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Points a stylesheet's package imports at the files they name, in the two server environments.
 *
 * A server component's CSS is compiled in the RSC environment, and that environment leaves `node_modules`
 * external — which Vite's CSS resolver takes to mean `@import 'tailwindcss'` has nothing to inline, and
 * then fails looking for a file of that name beside the stylesheet. Resolving it here, ahead of Vite's CSS
 * plugin, is the same answer the client environment would have given.
 */
function rsvhonoCssPackageImports(): Plugin {
  return {
    name: 'rsvhono:css-package-imports',
    enforce: 'pre',
    transform(code, id) {
      if (this.environment.name === 'client') return;
      const file = id.split('?', 1)[0];
      if (!file.endsWith('.css') || !code.includes('@import')) return;
      const rewritten = code.replace(CSS_PACKAGE_IMPORT, (match, at: string, quote: string, name: string, subpath: string) => {
        const resolved = resolveCssPackage(name, subpath, file);
        return resolved ? `${at}${quote}${resolved.split(sep).join('/')}${quote}` : match;
      });
      return rewritten === code ? undefined : { code: rewritten, map: null };
    },
  };
}

/**
 * Applies {@link shadowProcessEnv} to every module the SSR environment compiles — the app's own and any
 * dependency compiled into it. `post`, so it reads plain JavaScript and its `const process` lands after
 * every other transform has had the module.
 */
function rsvhonoEnvShadow(env: Record<string, string>, nodeEnv: string, srcDir: string): Plugin {
  const appSrcPrefix = srcDir + sep;
  return {
    name: 'rsvhono:env-shadow',
    enforce: 'post',
    transform(code, id) {
      if (this.environment.name !== 'ssr') return;
      const file = id.split('?', 1)[0];
      if (!/\.[cm]?[jt]sx?$/.test(file)) return;
      const shadowed = shadowProcessEnv(code, { env, nodeEnv });
      if (shadowed === null) return;
      // Only for the app's own source: a library feature-detecting `globalThis.process` is doing nothing
      // wrong and has no app secret to read.
      if (file.startsWith(appSrcPrefix) && readsGlobalProcess(code)) {
        this.warn(
          `[rsvhono] ${relative(srcDir, file)} reads \`process\` through the global object. It is rendered on the server as part ` +
            'of a client component, where `process.env` is shadowed with the `PUBLIC_`-only view — and that ' +
            'shadow is a binding, so it cannot cover `globalThis.process`. A variable read that way is the real ' +
            'one, and it ends up in the HTML. Read `process.env` directly instead.',
        );
      }
      // The prelude sits on the first line, so every mapping is still on its own line; columns on that one
      // line shift, which is the precision of a stack trace already.
      return { code: shadowed, map: null };
    },
  };
}

/** Resolves the framework's build-time specifiers, and serves the server-action allowlist. */
function rsvhonoCore(aliases: ReadonlyMap<string, string>, routesFile: string, srcDir: string, pageFiles: Set<string>, rootDir: string): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;

  return {
    name: 'rsvhono',

    // The plugin names its own runtime in `optimizeDeps.include`, resolvable from the project root only when
    // the app installed it. An app installs `@rsvhono/core`, so each entry is reached through that instead.
    configEnvironment(_name, config) {
      const include = config.optimizeDeps?.include;
      if (!include || existsSync(join(rootDir, 'node_modules', '@vitejs', 'plugin-rsc'))) return;
      config.optimizeDeps!.include = include.map((entry) => (entry.startsWith('@vitejs/plugin-rsc') ? `${PACKAGE_NAME} > ${entry}` : entry));
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    /**
     * The dev server's request path: anything outside `/_static/` is the app's.
     *
     * Registered ahead of Vite's own middleware rather than after it, because Vite answers a URL outside its
     * `base` itself — with a 404 suggesting the prefixed one. So the split is made here: `/_static/*` falls
     * through to Vite (client modules, HMR), and everything else is a `Request` for the RSC entry, loaded
     * through the module runner on each request so an edit is picked up without a restart.
     */
    configureServer(server) {
      const environment = server.environments.rsc;
      if (!isRunnableDevEnvironment(environment)) throw new Error('[rsvhono] the rsc environment cannot run modules in this process.');
      const entry = frameworkFile('runtime', 'entry.rsc.js');

      const listener = getRequestListener(async (request, env) => {
        try {
          const { default: handle } = await environment.runner.import<{ default: (request: Request, env: unknown) => Response | Promise<Response> }>(
            entry,
          );
          return await handle(request, env);
        } catch (error) {
          // The app's own failures are answered by the app. What lands here is a module that would not load
          // — a syntax error, a missing import — so say it in the terminal and in the browser's overlay.
          const failure = error instanceof Error ? error : new Error(String(error));
          server.ssrFixStacktrace(failure);
          console.error(failure);
          server.environments.client.hot.send({ type: 'error', err: { message: failure.message, stack: failure.stack ?? '' } });
          return new Response(failure.stack ?? failure.message, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        }
      });

      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith(STATIC_BASE)) return next();
        void listener(req, res);
      });
    },

    // A route added or re-pointed while the dev server runs is a page the next transform has to recognise.
    watchChange(id) {
      if (id === routesFile) scanPageFiles(routesFile, srcDir, pageFiles);
    },

    resolveId: {
      order: 'pre',
      handler(source, importer) {
        if (this.environment.name === 'client' && Object.hasOwn(SERVER_ONLY, source)) {
          const where = importer ? relative(rootDir, importer.split('?', 1)[0]) : 'a module in the browser bundle';
          this.error(`[rsvhono] ${where} imports '${source}', which the browser bundle cannot have.\n${SERVER_ONLY[source]}`);
        }
        if (source === SERVER_REFERENCES_ID) return RESOLVED_SERVER_REFERENCES_ID;
        return aliases.get(source);
      },
    },

    load(id) {
      if (id !== RESOLVED_SERVER_REFERENCES_ID) return;
      // The dev server finds a `'use server'` module when it first transforms it, so there is no list to
      // give. `runtime/server-references.ts` reads `null` as "ask the plugin per reference".
      if (this.environment.mode === 'dev') return 'export default null;';
      // The one place this reads the plugin's experimental API, and the same registry its own
      // `virtual:vite-rsc/server-references` is generated from — so the allowlist and the loader agree.
      const manager = resolvedConfig && getPluginApi(resolvedConfig)?.manager;
      if (!manager) throw new Error('[rsvhono] @vitejs/plugin-rsc is not registered.');
      const references: Record<string, string[]> = {};
      for (const meta of manager.serverReferences.metaMap.values()) references[meta.referenceKey] = [...meta.exportNames].sort();
      return `export default ${JSON.stringify(references)};`;
    },
  };
}

/**
 * Two warnings the bundler raises on every build, about things that are by design here, and that bury the
 * ones an app author can act on:
 *
 * - `SOURCEMAP_BROKEN` — the RSC plugin's own virtual modules are transformed without a source map;
 * - `MODULE_LEVEL_DIRECTIVE` — `'use client'` / `'use server'` "may not be preserved when bundling", which is
 *   the point: the RSC plugin has already read each directive and replaced the module with a reference.
 */
const EXPECTED_WARNINGS = new Set(['SOURCEMAP_BROKEN', 'MODULE_LEVEL_DIRECTIVE']);

function ignoreExpectedWarnings(warning: { code?: string }, warn: (warning: never) => void): void {
  if (!warning.code || !EXPECTED_WARNINGS.has(warning.code)) warn(warning as never);
}

/** One of the two server environments: what the deploy target needs of it. */
function serverEnvironment(preset: DeployPreset, outDir: string, entryFileName?: string): EnvironmentOptions {
  return {
    resolve: {
      // Compiled, never externalized: the entries import the aliases above and carry the `'use client'`
      // boundaries (`runtime/navigation.tsx`, `runtime/boundaries.tsx`) the plugin has to see.
      noExternal: preset.bundleDependencies ? true : [PACKAGE_NAME],
      ...(preset.resolveConditions ? { conditions: [...preset.resolveConditions] } : null),
    },
    build: {
      outDir,
      emptyOutDir: false,
      // Minified, with a map beside it that never leaves the server: a stack trace still names the source.
      minify: true,
      sourcemap: true,
      rollupOptions: {
        onwarn: ignoreExpectedWarnings,
        output: {
          ...(entryFileName ? { entryFileNames: entryFileName } : null),
          ...(preset.singleFile ? { codeSplitting: false } : null),
        },
      },
    },
  };
}

export function createViteConfig({ rootDir, isDev, config, preset }: ViteConfigOptions): InlineConfig {
  const srcDir = join(rootDir, 'src');

  // A react/react-dom split fails inside React at render time; this is the place that can say so.
  checkReactVersions(rootDir);

  const routesFile = firstExisting(srcDir, ['routes.ts', 'routes.tsx']);
  if (!routesFile) {
    throw new Error(`[rsvhono] src/routes.ts not found in ${rootDir} — it is the one required file.`);
  }

  const serverAppFile = firstExisting(srcDir, ['server.ts', 'server.tsx']);
  if (!isDev) warnAboutMissingSecurityMiddleware(srcDir, serverAppFile);

  /** Bare specifier → the file it stands for. */
  const aliases = new Map<string, string>([
    ['@rsvhono/routes', routesFile],
    ['@rsvhono/server-app', serverAppFile ?? frameworkFile('runtime', 'empty-server-app.js')],
    // The dev server is a Node process on this machine whatever the build will target.
    ['@rsvhono/deploy', frameworkFile(isDev ? join('deploy', 'dev', 'runtime.js') : preset.runtimeModule)],
  ]);

  /** The app's page modules, by file. Shared: filled here and on a routes edit, wrapped by `rsvhonoPages`, skipped by the RSC plugin. */
  const pageFiles = new Set<string>();
  scanPageFiles(routesFile, srcDir, pageFiles);

  const serverConfig: ServerConfig = {
    ...resolveServerConfig(config, { isDev, outDir: BUILD_OUT_DIR, envBindings: preset.envBindings }),
    ...(isDev ? { rootDir } : null),
  };
  // The browser's view of the environment, and the SSR pass's too: a client component renders in both,
  // and one that read the real `process.env` on the server would put a secret in the HTML and then
  // mismatch on hydration. The RSC environment keeps the real one — that is where server code runs.
  const browserEnv = publicEnv(isDev);
  const publicProcessEnv = { 'process.env': JSON.stringify(browserEnv) };
  const serverDir = join(BUILD_OUT_DIR, 'server');

  const generated: InlineConfig = {
    root: rootDir,
    configFile: false,
    appType: 'custom',
    base: STATIC_BASE,
    // `public/` is served at `/`, not under the base, and by the app itself (`mountPublicFallback`) so that
    // routes win over it the same way in dev and in production.
    publicDir: false,
    clearScreen: false,
    // Warnings and errors; the CLI prints its own progress lines.
    logLevel: 'warn',
    define: { __RSVHONO_CONFIG__: JSON.stringify(serverConfig) },
    resolve: { alias: { '@': srcDir } },
    environments: {
      // `main.mjs` is the one path `rsvhono start` and every platform's config name.
      rsc: {
        ...serverEnvironment(preset, serverDir, 'main.mjs'),
        // Vite leaves this a runtime read in a server build, which bundles the development half of every
        // `if (process.env.NODE_ENV === 'production')` in React beside the production one.
        define: { 'process.env.NODE_ENV': JSON.stringify(browserEnv.NODE_ENV) },
      },
      // No `define` here: `rsvhonoEnvShadow` replaces the whole `process` binding in this environment.
      ssr: serverEnvironment(preset, join(serverDir, 'ssr')),
      client: {
        define: publicProcessEnv,
        optimizeDeps: { exclude: [PACKAGE_NAME] },
        // No source map: this directory is public.
        build: { outDir: join(BUILD_OUT_DIR, 'static'), emptyOutDir: false, sourcemap: false, rollupOptions: { onwarn: ignoreExpectedWarnings } },
      },
    },
  };

  // The app's own Vite config goes over the generated one, and the framework's plugins after its own — so
  // an app plugin can transform a module before the RSC plugin reads its directives.
  const merged: InlineConfig = mergeConfig(generated, config.vite ?? {});
  return {
    ...merged,
    root: rootDir,
    configFile: false,
    base: STATIC_BASE,
    plugins: [
      ...(merged.plugins ?? []),
      react(),
      rsvhonoPages(pageFiles),
      rsc({
        entries: {
          rsc: frameworkFile('runtime', 'entry.rsc.js'),
          ssr: frameworkFile('runtime', 'entry.ssr.js'),
          client: frameworkFile('runtime', 'entry.client.js'),
        },
        // The request path is `configureServer` in `rsvhonoCore`, not the plugin's own middleware.
        serverHandler: false,
        rscCssTransform: { filter: (id) => !pageFiles.has(id.split('?', 1)[0]) },
      }),
      rsvhonoCore(aliases, routesFile, srcDir, pageFiles, rootDir),
      rsvhonoEnvShadow(browserEnv, browserEnv.NODE_ENV, srcDir),
      rsvhonoCssPackageImports(),
    ],
  };
}
