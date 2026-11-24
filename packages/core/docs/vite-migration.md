# Rspack → Vite RSC migration

The working record of moving `@rshono/core` from Rspack's native RSC support to
[`@vitejs/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc), without
dropping a feature. It follows the design package the migration was planned from (ADR-001 … ADR-012,
milestones M0 … M8, regression matrix T01 … T34) and records what has actually been built and measured.

**Status: M0 done, M1 done. `rshono build` / `rshono dev` still use Rspack; the Vite path is opt-in through
`@rshono/core/vite`.** Nothing in this document is a claim of feature parity.

## The rule

Features are not removed. What goes is duplicated machinery, bundler-specific plumbing, and the SPA fallback
for browsers without the Navigation API. Every deletion needs a replacement and a test.

## M0 — baseline

|                                                |                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Starting commit                                | `1fec4c7` (`@rshono/core` 1.0.0-rc.29)                                                                         |
| Node suite before any change                   | 370 tests, 370 pass (`node --test test/*.test.mjs`)                                                            |
| Browser suite after the seam                   | 95 tests, 95 pass (Playwright, system Chrome) — not run before the change, so this is a pass, not a comparison |
| Node suite after the seam                      | 370 pass — unchanged — plus 21 new in `test/vite.test.mjs`                                                     |
| Line coverage (`test:coverage`, threshold 82%) | 86.13% before, 86.45% after                                                                                    |

### Versions

| Package                    | Pinned | Why this one                                                                                 |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `vite`                     | 8.3.8  | current `latest`                                                                             |
| `@vitejs/plugin-rsc`       | 0.5.39 | current `latest`; a `0.x`, so pinned exactly                                                 |
| `@vitejs/plugin-react`     | 6.3.0  | current `latest`                                                                             |
| `react-server-dom-webpack` | 19.2.8 | **must equal `react` / `react-dom`**; added to the workspace `overrides` and to `check:pins` |
| `react`, `react-dom`       | 19.2.8 | unchanged — see below                                                                        |

`@vitejs/plugin-rsc` vendors its own copy of the RSC runtime (19.3.1 in this release) and uses an installed
`react-server-dom-webpack` instead when it finds one. A fallback would silently pair that copy with React
19.2.8, so both halves are checked: `check:pins` verifies the pin, and `test/vite.test.mjs` asserts the built
RSC bundle contains the installed package and not the vendored one.

**React stays on 19.2.8 for now.** The design targets 19.3.1+, and 19.3.1 is published. But
`react-server-dom-rspack` 0.1.0 is coupled to React's internals, and while both bundlers have to run the same
runtime and the same suite, moving React means moving it under Rspack too. The bump belongs with the
navigation work (M5, issue #87), after the Rspack path is gone or shown to hold on 19.3.

### What in the source is Rspack-specific

From `rg 'rspack|webpackHot|__webpack|server-entry|entryJsFiles|entryCssFiles' packages/core/src` at the
starting commit, and what becomes of each:

| File                                       | Lines     | What it does                                                                  | Under Vite                                                           |
| ------------------------------------------ | --------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `builder/rspack-config.ts`                 | 401       | both compiler configs, layers, externals, aliases, defines                    | `vite/index.ts` (216 lines so far)                                   |
| `builder/page-entry-loader.cjs`            | 34        | prepends `'use server-entry'` to page modules                                 | `rshonoPages` in `vite/index.ts` — see finding 1                     |
| `builder/page-files.ts`                    | 48        | finds page modules named by `routes.ts`                                       | **reused as is**                                                     |
| `builder/env-shadow-loader.cjs`            | 141       | hides non-`PUBLIC_` env from client components during SSR                     | a per-environment `define` so far — **not yet equivalent**, see gaps |
| `builder/server-only-imports.ts`           | 76        | refuses `server-only` in the client bundle                                    | plugin's `validateImports` (on by default) — parity untested         |
| `builder/react-versions.ts`                | 82        | refuses a react/react-dom split                                               | **reused as is**                                                     |
| `builder/public-env.ts`                    | 11        | the `PUBLIC_` view of `process.env`                                           | **reused as is**                                                     |
| `cli/build.ts`, `cli/dev.ts`               | 129 + 383 | compile, watch, worker, SSE                                                   | not started — M4 / M6                                                |
| `runtime/entry.rsc.tsx`                    | 1148      | imports the RSC runtime, reads the manifest, `entryJsFiles` / `entryCssFiles` | through the seam, below                                              |
| `runtime/entry.ssr.tsx`                    | 128       | imports the RSC client, `bootstrapScripts`                                    | through the seam                                                     |
| `runtime/entry.client.tsx`                 | 1576      | imports the RSC client, `__webpack_nonce__`, the dev refresh client           | through the seam                                                     |
| `runtime/hot-update.ts`, `dev-protocol.ts` | 60 + 18   | walking webpack hot updates, the SSE protocol                                 | Rspack only; deleted with it (M6)                                    |
| `runtime/validate-entries.ts`              | 437       | `assertPageModule` keys off `entryJsFiles`                                    | recognises a client reference directly under Vite                    |
| `deploy/presets.ts`                        | 208       | per-target Rspack overrides                                                   | not started — M4 / M7                                                |
| `config.ts`                                | 120       | the `rspack` hook                                                             | Vite config _is_ the escape hatch; the hook's fate is undecided      |
| `router.ts`                                | 461       | documents `'use server-entry'`                                                | the directive still works; docs follow the switch                    |
| `types/*.d.ts`                             | —         | ambient declarations for the above                                            | deleted with Rspack                                                  |

## M1 — the vertical slice

### The seam

The three runtime entries no longer name a bundler. They import

```ts
import { rsc } from '@rshono/bundler/rsc'; // entry.rsc.tsx
import { ssr } from '@rshono/bundler/ssr'; // entry.ssr.tsx
import { browser } from '@rshono/bundler/browser'; // entry.client.tsx
```

and the build resolves each to `src/bundler/rspack/*` (three aliases in `builder/rspack-config.ts`) or
`src/bundler/vite/*` (the resolver in `vite/index.ts`). The contract is `src/bundler/contract.ts`. It is the
same idiom as `@rshono/deploy`, and it is **temporary**: it exists so one runtime and one suite run on both
bundlers while the migration is in flight. When Rspack goes, the Vite implementations can be inlined.

What had to become part of the contract, beyond the React API itself:

| Member                      | Rspack                                             | Vite                                                                           |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `loadServerAction`          | synchronous `__webpack_require__`                  | `import()` — so it is a promise in the contract, and the three callers `await` |
| `hasServerAction`           | `Object.hasOwn(serverManifest, id)`                | build: a generated allowlist; dev: asks the plugin per reference               |
| `loadableServerActions`     | manifest entries without `chunks`                  | build: the allowlist; dev: none                                                |
| `pageAssets`                | `Page.entryJsFiles` / `entryCssFiles`              | nothing to carry — the plugin injects them                                     |
| `loadSsr`                   | a plain import (the layer is set by resource path) | `import.meta.viteRsc.loadModule('ssr', 'index')`                               |
| `ssr.bootstrap`             | `bootstrapScripts: <page scripts>`                 | `bootstrapModules: [getClientEntryUrl()]`                                      |
| `browser.setNonce`          | `__webpack_nonce__ = …`                            | no-op                                                                          |
| `browser.connectDevUpdates` | the SSE + `webpackHot` client, moved here verbatim | `import.meta.hot.on('rsc:update', refetch)`                                    |

Everything else in the entries — request classification, the Hono parent app, `RequestContext`, control
signals, abort forwarding, `flight-inject.ts`, the whole navigation client — is untouched and shared.

### What the Vite path does today

Verified by `test/vite.test.mjs` against `test/fixtures/vite-app`, on a production build served by
`vite preview` and on `vite dev`, with the browser parts in real Chromium:

| Matrix     | Verified                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| T01        | one document per URL, flight payload inlined; `RSC: 1` gets `text/x-component`; `Vary: RSC`                                        |
| T02        | the user's Hono sub-app wraps pages and flight; its own routes and an endpoint route answer                                        |
| T03        | route params reach the page                                                                                                        |
| T05        | hydration in a browser; client state survives an action's re-render                                                                |
| T06        | a page's CSS is attached and applies; one module entry                                                                             |
| T07        | a suspended subtree streams after the shell                                                                                        |
| T09        | `notFound()` and an unmatched path render the notFound page with 404; `redirect()` is a 303                                        |
| T10        | a server function called from the client returns its value with the re-rendered page; a throwing one is a 500 with `{ ok: false }` |
| T11        | a `useActionState` form posted with no JavaScript returns its state in the document                                                |
| T12        | unknown action id → 400, including an unknown export of a known module                                                             |
| T13 (dev)  | an id naming a page module, an endpoint module, a file outside the app or a missing file is refused before anything is called      |
| T17 (part) | a plain anchor and Back are soft navigations in the same document                                                                  |
| T29 (part) | a server-component edit re-renders and a client edit hot-swaps, both keeping client state, neither reloading                       |
| T31 (part) | a client component sees only `PUBLIC_` env during SSR; the secret is in no file under `dist/client` or `dist/ssr`                  |

"Part" means exactly what the row says and no more. No row here is the full matrix case.

### Findings

1. **The plugin's automatic CSS wrapper drops `ctx`.** For a server component whose module imports CSS, the
   plugin wraps the export and re-creates the element with `createElement(Component, props)`. That copies
   enumerable props, and `ctx` is deliberately non-enumerable (`pageProps` in `entry.rsc.tsx`) — so a page
   that imports a stylesheet rendered with `ctx` undefined. Pages are now excluded from that transform
   (`rscCssTransform.filter`) and wrapped by `rshonoPages`, which passes the props object through with
   `jsx(Page, props)` and attaches the page's CSS with `import.meta.viteRsc.loadCss()`. It applies to the same
   modules `page-entry-loader.cjs` did: inline `component: () => import('…')` thunks, and any module that
   declares `'use server-entry'`. **A page wired up another way that imports CSS and has no directive would
   still hit the plugin's wrapper** — the same escape hatch as under Rspack, but the failure is now a missing
   `ctx` rather than a build-time message. Closing that is open work.
2. **The dev server cannot enumerate server actions.** It discovers a `'use server'` module when it transforms
   it. The plugin validates each reference before importing anything, so `hasServerAction` asks it and reads
   its "invalid server reference" rejection as _unknown_ (400) and any other rejection as the module failing
   (500). That reads an error message from a `0.x` dependency; it is isolated in `bundler/vite/rsc.ts` and
   covered by a test. The build has no such dependency: it checks a generated allowlist of module key and
   export name.
3. **That allowlist reads the plugin's experimental API** (`getPluginApi(config).manager.serverReferences`),
   in one place (`vite/index.ts`), from the same registry the plugin's own loader is generated from.
4. **`<link rel=preload as="stylesheet">`.** Chromium warns about this once per page. It comes from React's
   Flight server emitting a preload hint for a `<link rel="stylesheet" precedence>` rendered in a server
   component, not from this repo; harmless, and not yet reported upstream.

### Gaps in the Vite path — known, not yet built

- **No prerendering.** `render: 'static'` pages are SSR'd per request; `deploy/vite/runtime.ts` has no
  prerendered store. (M4)
- **No deploy targets.** Only `vite dev` and `vite preview` serve the app. Node, Cloudflare, Vercel and Lambda
  packaging are untouched. (M4 / M7)
- **SSR env shadowing is weaker than `env-shadow-loader.cjs`.** A `define` replaces `process.env` in modules
  Vite compiles for the SSR environment. A client component from a dependency Vite externalizes there, or code
  reaching `globalThis.process`, is not covered — the loader handles the first and warns about the second. (M7)
- **CSP nonce under Vite is untested.** The nonce is passed to `renderToReadableStream` as before; whether
  every tag the plugin emits carries it has not been checked. (M7)
- **`.env` files are not loaded** by the Vite runtime (`loadEnv` is a no-op). (M2)
- **`rshono.config.ts`'s `rspack` hook is ignored**; `deploy` and `siteUrl` are read and unused. (M4)
- **Installed from the registry rather than the workspace**, `@rshono/core` sits in `node_modules`; it is set
  `noExternal` and the plugin's `optimizeDeps` entries are re-rooted through it, but only the workspace
  layout has been run. (M2)
- **The CLI and `@rshono/create` templates** still produce Rspack apps. (M4 / M6)

## Next

In the order the design gives, each with its own tests before the next starts:

|     | Work                                                                                                                                                              | Done when                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| M2  | HTTP parity: run the existing `prod.test.mjs` contract against a Vite build of the testbed; `.env`; registry-install layout                                       | the suite's HTTP cases pass on both bundlers    |
| M3  | Server Functions parity: bound args, temporary references, nested references through `onServerReference`, body limits, module-load failure vs unknown id at build | T10 – T13 in full                               |
| M4  | `buildApp` hook → existing `prerenderStaticRoutes`; deploy presets; `rshono build` on Vite                                                                        | T14 – T16, T32                                  |
| M5  | Navigation API only, React 19.3.1, commit-synchronised `finished`                                                                                                 | T17 – T28; issues #29 #40 #78 – #81 #85 #87     |
| M6  | `rshono dev` on Vite; delete the Rspack path, the seam and the SSE client                                                                                         | T29; Rspack removed from `dependencies`         |
| M7  | CSP / Trusted Types, env shadowing, platforms                                                                                                                     | T30 – T33                                       |
| M8  | parity audit, measurements                                                                                                                                        | every row of the feature table mapped to a test |

No performance or line-count claim is made here: nothing has been measured against the Rspack build yet, and
the design is explicit that such numbers are reported only after they are.
