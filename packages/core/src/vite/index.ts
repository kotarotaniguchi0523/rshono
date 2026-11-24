/**
 * `@rshono/core/vite` — the framework as a Vite plugin, built on `@vitejs/plugin-rsc`.
 *
 * ```ts
 * // vite.config.ts
 * import { rshono } from '@rshono/core/vite';
 * export default { plugins: [rshono()] };
 * ```
 *
 * **Migration status: the first vertical slice.** The same runtime entries the Rspack build compiles are
 * compiled here into Vite's three environments, so a page is rendered the same way — one RSC evaluation,
 * SSR'd with the flight payload inlined, hydrated — and server functions, the Hono sub-app and endpoints
 * run through the same code. What is *not* here yet: prerendering (`render: 'static'` pages are SSR'd per
 * request), the four deploy targets, and the SSR-side `process.env` guarantees `env-shadow-loader.cjs`
 * gives the Rspack build beyond a `define`. `rshono build` / `rshono dev` still use Rspack.
 */
import react from '@vitejs/plugin-react';
import rsc, { getPluginApi } from '@vitejs/plugin-rsc';
import { hasDirective, transformWrapExport } from '@vitejs/plugin-rsc/transforms';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAstAsync, type Plugin, type PluginOption, type ResolvedConfig } from 'vite';
import { scanPageFiles } from '../builder/page-files.js';
import { publicEnv } from '../builder/public-env.js';
import { checkReactVersions } from '../builder/react-versions.js';
import type { RshonoConfig } from '../config.js';
import { loadConfig } from '../server/load-config.js';
import { resolveServerConfig, type ServerConfig } from '../server/server-config.js';

// This file lives in `dist/vite/`, so everything below is the *built* framework — as in the Rspack config.
const FRAMEWORK_DIST = join(import.meta.dirname, '..');

const PACKAGE_NAME = '@rshono/core';

const SERVER_REFERENCES_ID = 'virtual:rshono/server-references';
const RESOLVED_SERVER_REFERENCES_ID = '\0' + SERVER_REFERENCES_ID;

export interface RshonoPluginOptions {
  /** The app's config. Defaults to `rshono.config.{ts,js,mjs}` in the Vite root, when there is one. */
  config?: RshonoConfig;
  /** Pass `false` when the Vite config registers `@vitejs/plugin-react` (or an equivalent) itself. */
  react?: boolean;
}

const frameworkFile = (...segments: string[]): string => join(FRAMEWORK_DIST, ...segments);

function firstExisting(dir: string, names: string[]): string | undefined {
  return names.map((name) => join(dir, name)).find(existsSync);
}

/** Appended to a page module by {@link rshonoPages}. `jsx(value, props)`, never `createElement` — see there. */
const WRAP_PAGE = `
import { jsx as __rshono_jsx, jsxs as __rshono_jsxs, Fragment as __rshono_Fragment } from "react/jsx-runtime";
function __rshono_wrap_page__(value, name) {
  if (typeof value !== "function") return value;
  function __wrapper(props) {
    return __rshono_jsxs(__rshono_Fragment, { children: [import.meta.viteRsc.loadCss(), __rshono_jsx(value, props)] });
  }
  Object.defineProperty(__wrapper, "name", { value: name });
  return __wrapper;
}
`;

/**
 * Attaches a page's stylesheets to the page — the Vite counterpart of `page-entry-loader.cjs`, and for the
 * same set of modules: the ones `routes.ts` names with an inline `component: () => import('…')` thunk, plus
 * any that declare `'use server-entry'` themselves.
 *
 * `@vitejs/plugin-rsc` would do this by itself for a component whose module imports CSS, and it must not be
 * allowed to for a page: its wrapper re-creates the element with `createElement(Page, props)`, which copies
 * the *enumerable* props and so drops `ctx` — deliberately non-enumerable, see `pageProps` in
 * `runtime/entry.rsc.tsx`. The page would render with `ctx` undefined. So pages are taken out of the plugin's
 * transform (`rscCssTransform.filter` in {@link rshono}) and wrapped here instead, passing the props object
 * through untouched. Registered ahead of the plugin so a hand-written directive is seen before its filter runs.
 */
function rshonoPages(pageFiles: Set<string>): Plugin {
  return {
    name: 'rshono:pages',
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
        runtime: (value, name, meta) => `__rshono_wrap_page__(${value}, ${JSON.stringify(meta.defaultExportIdentifierName ?? name)})`,
        filter: (name) => name === 'default',
        ignoreExportAllDeclaration: true,
      });
      if (!output.hasChanged()) return;
      output.append(WRAP_PAGE);
      return { code: output.toString(), map: output.generateMap({ hires: 'boundary' }) };
    },
  };
}

function rshonoCore(options: RshonoPluginOptions, pageFiles: Set<string>): Plugin {
  let rootDir = process.cwd();
  let routesFile: string | undefined;
  let srcDir = join(rootDir, 'src');
  let resolvedConfig: ResolvedConfig | undefined;
  /** Bare specifier → the file it stands for. Filled in `config`, once the root is known. */
  const aliases = new Map<string, string>();

  return {
    name: 'rshono',

    async config(userConfig, env) {
      rootDir = resolve(userConfig.root ?? process.cwd());
      srcDir = join(rootDir, 'src');
      const isDev = env.command === 'serve' && !env.isPreview;

      // A react/react-dom split fails inside React at render time; this is the place that can say so.
      checkReactVersions(rootDir);

      routesFile = firstExisting(srcDir, ['routes.ts', 'routes.tsx']);
      if (!routesFile) {
        throw new Error(`[rshono] src/routes.ts not found in ${rootDir} — it is the one required file.`);
      }
      aliases.set('@rshono/routes', routesFile);
      scanPageFiles(routesFile, srcDir, pageFiles);
      aliases.set('@rshono/server-app', firstExisting(srcDir, ['server.ts', 'server.tsx']) ?? frameworkFile('runtime', 'empty-server-app.js'));
      aliases.set('@rshono/deploy', frameworkFile('deploy', 'vite', 'runtime.js'));
      for (const side of ['rsc', 'ssr', 'browser']) aliases.set(`@rshono/bundler/${side}`, frameworkFile('bundler', 'vite', `${side}.js`));

      const appConfig = options.config ?? (await loadConfig(rootDir));
      const serverConfig: ServerConfig = {
        ...resolveServerConfig(appConfig, { isDev, outDir: userConfig.build?.outDir ?? 'dist' }),
        bundler: 'vite',
      };
      // The browser's view of the environment, and the SSR pass's too: a client component renders in both,
      // and one that read the real `process.env` on the server would put a secret in the HTML and then
      // mismatch on hydration. The RSC environment keeps the real one — that is where server code runs.
      const publicProcessEnv = { 'process.env': JSON.stringify(publicEnv(isDev)) };
      // Compiled, never externalized: the entries import the aliases above and carry the `'use client'`
      // boundaries (`runtime/navigation.tsx`, `runtime/boundaries.tsx`) the plugin has to see.
      const bundleFramework = { resolve: { noExternal: [PACKAGE_NAME] } };

      return {
        appType: 'custom',
        define: { __RSHONO_CONFIG__: JSON.stringify(serverConfig) },
        resolve: { alias: { '@': srcDir } },
        environments: {
          rsc: { ...bundleFramework },
          ssr: { ...bundleFramework, define: publicProcessEnv },
          client: { define: publicProcessEnv, optimizeDeps: { exclude: [PACKAGE_NAME] } },
        },
      };
    },

    // The plugin names its own runtime in `optimizeDeps.include`, resolvable from the project root only when
    // the app installed it. An app installs `@rshono/core`, so each entry is reached through that instead.
    configEnvironment(_name, config) {
      const include = config.optimizeDeps?.include;
      if (!include || existsSync(join(rootDir, 'node_modules', '@vitejs', 'plugin-rsc'))) return;
      config.optimizeDeps!.include = include.map((entry) => (entry.startsWith('@vitejs/plugin-rsc') ? `${PACKAGE_NAME} > ${entry}` : entry));
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    // A route added or re-pointed while the dev server runs is a page the next transform has to recognise.
    watchChange(id) {
      if (routesFile && id === routesFile) scanPageFiles(routesFile, srcDir, pageFiles);
    },

    resolveId: {
      order: 'pre',
      handler(source) {
        if (source === SERVER_REFERENCES_ID) return RESOLVED_SERVER_REFERENCES_ID;
        return aliases.get(source);
      },
    },

    load(id) {
      if (id !== RESOLVED_SERVER_REFERENCES_ID) return;
      // The dev server finds a `'use server'` module when it first transforms it, so there is no list to
      // give. `bundler/vite/rsc.ts` reads `null` as "ask the plugin per reference".
      if (this.environment.mode === 'dev') return 'export default null;';
      // The one place this reads the plugin's experimental API, and the same registry its own
      // `virtual:vite-rsc/server-references` is generated from — so the allowlist and the loader agree.
      const manager = resolvedConfig && getPluginApi(resolvedConfig)?.manager;
      if (!manager) throw new Error('[rshono] @vitejs/plugin-rsc is not registered — `rshono()` adds it; was it filtered out?');
      const references: Record<string, string[]> = {};
      for (const meta of manager.serverReferences.metaMap.values()) references[meta.referenceKey] = [...meta.exportNames].sort();
      return `export default ${JSON.stringify(references)};`;
    },
  };
}

/** The framework's Vite plugins: `@vitejs/plugin-react`, `@vitejs/plugin-rsc` wired to the rshono runtime, and the glue. */
export function rshono(options: RshonoPluginOptions = {}): PluginOption {
  /** The app's page modules, by file. Shared: one plugin fills it, one wraps them, and the RSC plugin skips them. */
  const pageFiles = new Set<string>();
  return [
    options.react === false ? null : react(),
    rshonoPages(pageFiles),
    rsc({
      rscCssTransform: { filter: (id) => !pageFiles.has(id.split('?', 1)[0]) },
      entries: {
        rsc: frameworkFile('runtime', 'entry.rsc.js'),
        ssr: frameworkFile('runtime', 'entry.ssr.js'),
        client: frameworkFile('runtime', 'entry.client.js'),
      },
    }),
    rshonoCore(options, pageFiles),
  ];
}

export default rshono;
