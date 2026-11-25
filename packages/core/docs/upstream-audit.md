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
- **`chunkImportMap` (Vite 8.3.8, experimental).** Measured, then refused. On the testbed (23 browser
  files, 289 kB), editing one leaf client component renames 20 files / 275 kB without it — the entry chunk
  holds the client-reference map, so its hash changes and every importer's follows — and 1 file / 0.6 kB with
  it on for the client environment. But the bundle then imports chunks by names only an import map in the
  document resolves, and nothing here writes one: it would have to precede the first module script and
  preload in React's stream, with the nonce, on rendered and prerendered documents alike, and agree with the
  names in the plugin's asset manifest. Set at the top level it also reaches the server environments, where
  Node has no import map and `main.mjs` fails to load. So a build with it on now stops with a message
  (`test/build-stability.test.mjs`). Wiring the map through `renderToReadableStream`'s `importMap` is the
  largest caching win left on the table and is not done.
- **The build id and chunk names.** Found by the same measurement: the id, new on every build, was a
  literal in the browser bundle, so rebuilding _unchanged_ source renamed 20 of 23 files. It is now handed
  to the browser by the document, and an identical rebuild produces identical files (0 renamed).
- **`preserveServerReferences`, `use cache`, PPR.** Tried, as a testbed page and not as a framework feature:
  `/flight-replay` renders a fragment to flight once with the plugin's `renderToReadableStream`, keeps the
  bytes, and decodes them back into the tree on later requests with `createFromReadableStream(…, {},
{ preserveServerReferences: true })` — the `cache-replay` example's method. It works on this renderer: the
  fragment renders once, and the `<form action={serverFunction}>` inside it is written out as a reference
  again and still runs. What a real cache would need on top is everything that page leaves out — a key,
  invalidation, the build id on stored flight, per-user separation, a bound on memory — and none of that
  was built. `'use cache'` and PPR were not tried, by decision: neither is wanted in this round.
- **`@rolldown/plugin-transform-imports` (0.1.3).** An app can add it under `vite.plugins` like any plugin;
  the framework does not depend on it and ships no preset for it. Exercised by the `toolchain-app` fixture:
  a one-name import from a four-module barrel ships one module instead of four, in the browser chunk and in
  the SSR chunk (`test/toolchain.test.mjs`).
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
since — so they bound the cost from above rather than measure it.

### What the current build costs

`node test/experiments/measure.mjs`, on the machine the suite runs on (Linux container, Node 22, headless
Chrome on the same host, so network time is nil). Medians unless said otherwise. These are one machine's
numbers: useful against each other and against a re-run, not as claims about anyone's production.

|                                                                    |                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `rsvhono build`, testbed                                           | 1.5 s                                                         |
| browser JS / CSS                                                   | 283 kB (92.7 kB gzipped per file) / 5.8 kB                    |
| server JS                                                          | 531 kB                                                        |
| `rsvhono start` to listening                                       | 0.12 s, 78 MB resident                                        |
| rendered document, `/users`                                        | p50 2.2 ms, p95 4.8 ms                                        |
| its flight payload                                                 | p50 1.4 ms, p95 3.9 ms                                        |
| prerendered document                                               | p50 0.9 ms, p95 2.3 ms                                        |
| 50 responses streaming at once (each suspended 2 s)                | all done in 2.11 s, 143 MB resident                           |
| resident memory after 5k / 10k / 15k / 20k requests                | 216 / 225 / 225 / 225 MB — it levels off                      |
| first load of `/`: TTFB / FCP / hydrated                           | 16 ms / 88 ms / 122 ms, 10 requests, 272 kB of JS on the wire |
| soft navigation `/` → `/users`                                     | 29 ms                                                         |
| `rsvhono dev` to listening / first request                         | 0.24 s / 1.7 s, 418 MB resident                               |
| dev, warm request                                                  | p50 5.8 ms                                                    |
| edit → on screen: server component / client component / stylesheet | 84 ms / 50 ms / 66 ms                                         |

Two things these show that are not the framework's doing but are worth knowing: `rsvhono start` serves
`/_static/` uncompressed (272 kB on the wire for 93 kB of gzip), which is a CDN's or a proxy's job and is
not done here; and in dev, a second write to one client module within tens of milliseconds of the first
being applied was seen to be dropped, which the measurement works around by waiting. A third dev-only
observation, from `test/hmr.test.mjs`: editing a `'use server'` module that a client component imports takes
effect on the next call without a reload, but the importing component keeps its state only about half the
time — the edit is both a Fast Refresh and a payload re-read, and their order is not fixed. Not fixed here.

### What React Compiler does to the fixture

`react: { compiler: true }` with `oxc-transform-react` 0.158.0, on the `toolchain-app` fixture's `Board`:

- the browser chunk is compiled, the SSR chunk is not (the plugin compiles the client environment only),
  and the page hydrates with no mismatch;
- the dev server serves the compiled module, with Fast Refresh still attached;
- bumping an unrelated counter three times re-renders the child 3 times uncompiled and 0 times compiled
  (`test/browser/toolchain.spec.mjs`);
- the component's chunk grows from 719 B to 1247 B.

Line counts went up, not down: this round added features (a function guard, an origin rule, build ids,
prefetch, chunk recovery, the reachability manifest) on top of the three replacements that removed code.
