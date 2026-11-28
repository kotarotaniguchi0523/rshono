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
| Which file a page thunk names               | Vite's resolver (`this.resolve`, RSC environment), from `rsvhono:pages`          | `page-files.ts`'s own: relative and `@/` only, four extensions, `index` probing  |
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
- **Telling a server module that will not load from a body that will not decode.** `decodeAction` reports
  both through one rejection, and `@vitejs/plugin-rsc` 0.5.39 exports nothing that says which: the public
  surface is `decodeAction(body, options)` and `loadServerAction(id)`, with no typed error and no "is this
  module loadable" query. So `cannotLoadServerActions` still answers the question by loading an action for
  real. It cannot be made smaller on this API; a typed load error upstream would replace it.
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

The two columns are the same script and **the same testbed source**, built by the framework at `4a184b4`
(before the review round that added prefetch rules, chunk-recovery ownership, the result-only lifecycle and
resolver delegation) and by the framework now, so the difference is the framework's alone. Each was run
twice and the second run is shown; a first run in a fresh checkout pays for a cold dependency cache.

|                                                                        | `4a184b4`                    | now                          |
| ---------------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| `rsvhono build`, testbed (best of 5 / median of 3)                     | — / 1.60 s                   | 1.56 s / 1.77 s              |
| browser JS, raw / gzipped per file                                     | 285.7 / 93.9 kB              | 286.7 / 94.3 kB              |
| server JS                                                              | 538.9 kB                     | 539.5 kB                     |
| `rsvhono start` to listening, resident memory                          | 0.13 s, 78 MB                | 0.12 s, 78 MB                |
| rendered document, `/users` (p50 / p95)                                | 2.3 / 5.6 ms                 | 2.3 / 5.6 ms                 |
| its flight payload (p50 / p95)                                         | 1.4 / 3.7 ms                 | 1.4 / 4.0 ms                 |
| prerendered document (p50)                                             | 0.9 ms                       | 0.9 ms                       |
| a streamed payload: first byte / last byte (page suspends 2 s)         | 5 ms / 2.01 s                | 4 ms / 2.01 s                |
| 50 responses streaming at once: all done, resident memory              | 2.11 s, 139 MB               | 2.12 s, 143 MB               |
| resident memory after 5k / 10k / 15k / 20k requests                    | 218 / 226 / 226 / 226        | 212 / 216 / 215 / 217        |
| first load of `/`: TTFB / FCP / hydrated                               | 16 / 92 / 121 ms             | 15 / 88 / 115 ms             |
| `navigate()` to commit, `/transition-probe` → `/users`                 | 16 ms                        | 18.5 ms                      |
| browser heap: idle / 4 prefetches held / after 400 more / after a call | 1736 / 1959 / 1991 / 2833 kB | 1722 / 1949 / 1980 / 2839 kB |
| `rsvhono dev` to listening / first request                             | 0.25 s / 1.9 s               | 0.31 s / 2.0 s               |
| dev resident memory                                                    | 413 MB                       | 423 MB                       |
| edit → on screen: server component / client component / stylesheet     | 98 / 49 / 66 ms              | 99 / 50 / 74 ms              |
| source lines: `builder/` / `runtime/` / all of `src/`                  | 743 / 6264 / 10029           | 823 / 6469 / 10315           |

Read plainly: this round changed correctness, not speed. Every timing is inside the spread between two runs
of the same code; memory levels off the same way; the browser bundle grew by 1.0 kB (0.4 kB gzipped) and the
source by 286 lines, most of it comments and the two modules split out to be testable. The one figure that
looked like a regression — the median build time — did not survive a second look: best of five is 1.56 s,
and resolving every page thunk through Vite at `buildStart` measures at about 13 ms of it.

Four prefetched payloads cost about 225 kB of browser heap while held, and turning 400 more over in the same
four slots adds 30 kB that does not grow further (960 in a row level off at +100 kB): nothing is kept per
prefetch. The jump after a server function is that call's own first run, the same in both columns.

Two things these show that are not the framework's doing but are worth knowing: `rsvhono start` serves
`/_static/` uncompressed (273 kB on the wire for 94 kB of gzip), which is a CDN's or a proxy's job and is
not done here; and in dev, a second write to one client module within tens of milliseconds of the first
being applied was seen to be dropped, which the measurement works around by waiting. A third dev-only
observation, from `test/hmr.test.mjs`: editing a `'use server'` module that a client component imports takes
effect on the next call without a reload, but the importing component keeps its state only about half the
time — the edit is both a Fast Refresh and a payload re-read, and their order is not fixed. Not fixed here.

### Against the Rspack build this replaced

The testbed cannot answer this — it has grown by a dozen routes since — so the comparison is on the one app
that is the same at both ends: the `minimal-app` fixture (four pages, one endpoint, no client components),
built by `main` (Rspack 2.2.8, `react-server-dom-rspack` 0.1.0) and by this branch. Two runs each.

|                                       | `main` (Rspack)  | this branch (Vite 8) |
| ------------------------------------- | ---------------- | -------------------- |
| build, best of 5                      | 0.76–0.84 s      | 0.92–0.96 s          |
| browser JS, raw / gzipped             | 230.2 / 72.7 kB  | 266.1 / 83.4 kB      |
| server JS, raw / gzipped              | 382.5 / 120.2 kB | 368.8 / 114.7 kB     |
| `start` to listening, resident memory | 0.09 s, 84 MB    | 0.09 s, 102 MB       |
| document / payload, p50               | 1.5–1.7 / 2.3 ms | 1.7–1.8 / 2.4 ms     |
| `dev` to listening                    | 0.15 s           | 0.25 s (0.6 s cold)  |
| dev, first request                    | 0.55 s           | 1.7–1.9 s            |
| dev, warm request p50                 | 6.6–8.9 ms       | 4.6–5.1 ms           |
| dev resident memory                   | 255–261 MB       | 401 MB (621 MB cold) |

The migration did not make this app faster to build or lighter to run. The build is about 0.15 s slower, the
dev server takes three times as long to answer its first request and holds 140 MB more, and the browser
bundle is 36 kB larger (10.7 kB gzipped) — that last one is not the bundler: the app has no client code of
its own, so the difference is the client runtime written since (page resources, route intents, prefetch,
build ids, chunk recovery). What it bought is on the other side of the ledger — the server bundle is
smaller, a warm dev request is faster, and the five hand-maintained pieces listed at the top of this
document are upstream's now.

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
