# What is delegated upstream, what is not, and what it cost

A record of going through Vite, Rolldown/Oxc, `@vitejs/plugin-rsc`, React and Waku for things this
framework was doing by hand. Baseline `4da8042`; versions Vite 8.3.8, `@vitejs/plugin-rsc` 0.5.39,
`@vitejs/plugin-react` 6.3.0, React 19.3.1.

`main` and the released tag were compared for the plugin's examples: the list of example directories is the
same at `plugin-rsc@0.5.39` and on `main`. Where an API named in a review exists only on `main`, it says so
below.

## Adopted

| What                                        | Upstream piece                                                                   | What it replaced                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `process.env` shadowing in the SSR bundle   | `transformWithOxc` (`define` + `inject`), Vite 8.3.8                             | a text transform: three regular expressions, a prologue scanner, a prelude       |
| A page's stylesheets                        | `import.meta.viteRsc.loadCss()`, 0.5.39                                          | an AST wrap of the page's default export (`transformWrapExport`) and a component |
| CSS package imports in the server bundles   | `createIdResolver`, Vite 8.3.8                                                   | reading `package.json` `style` / `main` / `exports` by hand                      |
| Which functions a route reaches             | the method of the `action-reachability` example; `getModuleInfo`, `getPluginApi` | nothing — it did not exist                                                       |
| Server-only modules of an app               | the plugin's `validateImports` (`import 'server-only'`)                          | nothing of ours; now tested under our config                                     |
| Reference checks while decoding             | `onServerReference` on `decodeReply` / `decodeAction` / `decodeFormState`        | a check on the request header alone                                              |
| Per-render data dedupe, render-scoped abort | React `cache()`, `cacheSignal()`                                                 | nothing — tested, not wrapped                                                    |
| Browser-only components                     | React DOM `browser()`                                                            | nothing — tested, not wrapped                                                    |
| React Compiler                              | `@vitejs/plugin-react`'s `compiler` option, through `config.react`               | nothing; a second `react()` would have doubled the plugin                        |
| Transition direction for view transitions   | React `addTransitionType`                                                        | nothing                                                                          |
| Chunk-load recovery                         | Vite's `vite:preloadError`; React's `bootstrapScriptContent`                     | nothing — a missing entry chunk was unrecoverable                                |

## Looked at and not adopted

- **`import 'server-only'` on `@rsvhono/core/server` itself.** The plugin's check would replace the
  framework's own `resolveId` refusal, with a better message (the import chain). But the marker is resolved by
  the plugin: outside Vite it is the `server-only` package, which throws unless the `react-server` condition
  is set. An app's unit tests import `@rsvhono/core/server` in plain Node. The framework's check stays.
- **`setResourceOptionsCallback` (CSP nonce on client-reference preloads).** Not in 0.5.39, which is the
  newest release. The plugin calls `preloadModule` / `preinit` with no nonce and no hook.
- **`serverHandler` (the plugin's dev request path).** Still `false`. It serves under Vite's `base`, and the
  app's pages are not under `/_static/`.
- **`prerender()` for SSG.** The build already renders HTML and flight in one pass through the built server
  entry; `prerender()` would be a second way to do the same thing.
- **`rsc-html-stream` in place of `flight-inject.ts`.** 0.0.8 does the injection, the script escaping and the
  nonce. It does not capture the flight for a prerendered page, and it does not expose the abort and
  listener-release paths `flight-inject.ts` is tested for. Replacing the part it covers would leave two
  implementations of one stream.
- **`chunkImportMap` (Vite 8.3.8, experimental).** The option exists and the client build writes
  `dist/static/importmap.json`. Nothing puts an import map in the document: Vite expects the backend to, and
  the document here is React's stream, where the map would have to precede the first module script on every
  response, with the nonce. Not wired; the build id and chunk recovery do not depend on it.
- **`preserveServerReferences`, `use cache`, PPR.** `preserveServerReferences` is in 0.5.39's
  `createFromReadableStream` options. It matters when a stored flight is decoded on the server to be built
  into a new tree, which nothing here does: a prerendered payload is served as bytes. No fixture was built.
- **`@rolldown/plugin-transform-imports` (0.1.3).** An app can add it under `vite.plugins` like any plugin;
  the framework does not depend on it and ships no preset for it. Not exercised here.
- **`vitest-plugin-rsc` (0.3.0).** Not added. The suite's value is in real requests through Hono and a real
  browser; a third runner for component-level cases would duplicate a small part of that.
- **RSC debug channel.** The options exist in 0.5.39. The development timing track
  (`browser/timing.ts`) and React's own tracks covered what was wanted without it.
- **Waku's weak-promise flight filter**, its Slot/Slice store and its route-intent follow limit: read, not
  copied. See `client-runtime.md`.

## Still the framework's own, and why

- **`rsvhono:pages`** — now only appends two exports to a page module. It has to exist: the plugin's CSS
  wrapper re-creates the element with `createElement(Page, props)` and drops the non-enumerable `ctx`, so
  pages are taken out of that transform and given their stylesheets another way. An upstream change from
  `createElement(value, props)` to passing the props object through would remove the reason.
- **`rsvhono:env-shadow`** — the plugin around the Oxc call: which environment, which files, and the two
  reads no binding can cover (`globalThis.process`, an import of `node:process`).
- **`rsvhono:css-package-imports`** — the `@import` rewrite in the two server environments. The resolving is
  Vite's; finding the import in the stylesheet is still a regular expression.
- **The dev middleware** — routes everything outside `/_static/` to the RSC entry.

## Numbers

Testbed app, same machine, three production builds each.

|                                    | `4da8042`             | now                          | note                                                                  |
| ---------------------------------- | --------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `builder/vite-config.ts`           | 460 lines             | 555                          | +route-functions plugin, +build id, −wrapper, −manifest reading       |
| `builder/env-shadow.ts`            | 126                   | 65                           |                                                                       |
| `builder/` total                   | 704                   | 738                          |                                                                       |
| `runtime/` total                   | 5473                  | 6238                         | guard, origin rule, build id, prefetch, chunk recovery, route intents |
| own Vite plugins                   | 4                     | 5                            | +`rsvhono:route-functions` (build only)                               |
| AST passes of ours per page module | 2 (parse, wrap)       | 1 (parse, for the directive) |                                                                       |
| build time                         | 1.4–1.5 s             | 1.6–1.7 s                    | the testbed has eleven more routes now                                |
| browser JS                         | 278 kB (86.8 kB gzip) | 283 kB (88.3 kB gzip)        | same caveat                                                           |
| server JS                          | 519 kB                | 529 kB                       | same caveat                                                           |
| new runtime dependencies           | —                     | none                         |                                                                       |

The build-time and size rows compare two different testbeds — the baseline has none of the pages added
since — so they bound the cost from above rather than measure it. HMR time, first-load time and memory under
streaming were not measured.

Line counts went up, not down: this round added features (a function guard, an origin rule, build ids,
prefetch, chunk recovery, the reachability manifest) on top of the three replacements that removed code.
