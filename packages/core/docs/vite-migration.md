# Rspack → Vite

`@rshono/core` used to be built on Rspack's native RSC support. It is now built on Vite, with
[`@vitejs/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc) and React's
own `react-server-dom-webpack`. This is the record of that replacement: what was measured, what changed
shape, what is known to be weaker than before, and what the original design still asks for.

The Rspack path is gone, not kept beside this one. There is no compatibility layer.

## What was measured

|                                                                                                                                                                                         | Before (Rspack, `1fec4c7`) | After (Vite)                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| Node suite (`node --test test/*.test.mjs`)                                                                                                                                              | 370 pass                   | 352 pass, 0 fail                                            |
| Browser suite (Playwright, 95 cases, unchanged)                                                                                                                                         | 95 pass                    | 95 pass                                                     |
| `@rshono/create` suite                                                                                                                                                                  | —                          | 39 pass                                                     |
| `@rshono/create` end to end (`CREATE_RSHONO_E2E=1`): a scaffolded app installed from the packed tarball, under npm and under pnpm, typechecked and built; Tailwind; every deploy target | —                          | 4 of 6 run, 4 pass — the two lint-preset cases were not run |
| `apps/website` (`cloudflare`)                                                                                                                                                           | —                          | builds; `wrangler deploy --dry-run` bundles it              |

The Node count went down because tests of deleted machinery went with it — the Rspack config objects, the
two loaders, the webpack hot-update walker, the dev worker and its SSE channel — and came back as fewer,
different tests: the generated Vite config, `shadowProcessEnv`, the dev server's action allowlist, HMR in a
real browser. No test of framework _behaviour_ was removed. The ones whose assertions named a bundler's
output were re-pointed, not relaxed: asset URLs (`/_static/assets/<name>-<hash>.<ext>`), action ids
(`<module key>#<export>`), and the patch that breaks a build's action module on purpose.

Nothing here is a performance or size claim. Neither build has been benchmarked against the other, and the
figures in `packages/benchmarks` and `apps/website/content/benchmarks.md` were measured on the Rspack build —
they describe a bundler this package no longer uses until they are re-run.

## Versions

| Package                    | Pinned |                                                                                     |
| -------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `vite`                     | 8.3.8  |                                                                                     |
| `@vitejs/plugin-rsc`       | 0.5.39 | a `0.x`: pinned exactly                                                             |
| `@vitejs/plugin-react`     | 6.3.0  |                                                                                     |
| `react-server-dom-webpack` | 19.2.8 | **must equal `react` / `react-dom`**; in the workspace `overrides` and `check:pins` |
| `react`, `react-dom`       | 19.2.8 | unchanged — see "Still open"                                                        |

The plugin vendors its own copy of the RSC runtime (19.3.1 in this release) and uses an installed
`react-server-dom-webpack` instead when it finds one. A silent fallback would pair that copy with React
19.2.8, so `test/hmr.test.mjs` asserts the built bundle contains the installed package and not the vendored
one.

## What replaced what

| Was                                                                                           | Is                                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `builder/rspack-config.ts` — two compiler configs, layers, externals                          | `builder/vite-config.ts` — one Vite config, three environments                                 |
| `builder/page-entry-loader.cjs` — `'use server-entry'` on page modules                        | `rshono:pages` — wraps page modules; see "The page wrapper"                                    |
| `builder/env-shadow-loader.cjs`                                                               | `builder/env-shadow.ts` + `rshono:env-shadow`, same algorithm, SSR environment                 |
| `builder/server-only-imports.ts`                                                              | a `resolveId` check in the client environment, same message                                    |
| `cli/dev.ts` — two watchers, a worker thread per rebuild, a proxy, an SSE channel (383 lines) | one Vite dev server (82 lines)                                                                 |
| `runtime/hot-update.ts`, `runtime/dev-protocol.ts` — the webpack HMR client                   | `import.meta.hot.on('rsc:update')` in `entry.client.tsx`; client edits are Vite's Fast Refresh |
| `Page.entryJsFiles` / `entryCssFiles`                                                         | nothing to carry: one module entry, CSS injected where a page renders                          |
| Rspack's `serverManifest` as the action allowlist                                             | `virtual:rshono/server-references` — see "Server actions"                                      |
| the `rspack(config, ctx)` hook                                                                | `vite`, a config merged over the generated one                                                 |
| `postcss-loader` wired through that hook                                                      | nothing: Vite runs `postcss.config.mjs` itself                                                 |
| `@rshono/create`'s own Rspack bundle                                                          | a Vite SSR build (`packages/create/scripts/build.mjs`)                                         |

Unchanged above the bundler: the Hono parent app and request classification, `RequestContext`, control
signals, abort forwarding, `flight-inject.ts`, the whole navigation client, prerendering
(`server/ssg.ts`), the four deploy runtimes and their `finalize` steps. The output layout was kept on
purpose — `dist/server/main.mjs`, `dist/static` at `/_static/`, `dist/public`, `dist/ssg` — so everything
that reads it kept working.

## Decisions worth knowing about

**The page wrapper.** For a server component whose module imports CSS, the RSC plugin wraps the export and
re-creates the element with `createElement(Component, props)`. That copies enumerable props, and a page's
`ctx` is deliberately non-enumerable — so a page importing a stylesheet rendered with `ctx` undefined. Pages
are excluded from that transform and wrapped by `rshono:pages` instead, which passes the props object
through and marks the wrapper. `assertPageModule` requires the mark, so a page the build did not recognise —
wired up some way other than an inline `component: () => import('…')` thunk or a `'use server-entry'`
directive — fails with a message, at build time and at request time, rather than rendering without `ctx`.

**Server actions.** A build generates an allowlist of module key and export names from the plugin's own
reference registry, read through its experimental `getPluginApi` in one place (`builder/vite-config.ts`).
The dev server cannot enumerate actions — it discovers a `'use server'` module when it transforms it — so
there `hasServerAction` asks the plugin per reference and reads its "invalid server reference" rejection as
_unknown_ (400) and any other as the module failing (500). That reads an error message from a `0.x`
dependency; it is in one function (`runtime/server-references.ts`) and under test.

**CSS package imports in server environments.** A server component's stylesheet is compiled in the RSC
environment, which leaves `node_modules` external; Vite's CSS resolver then fails on `@import 'tailwindcss'`.
`rshono:css-package-imports` resolves such imports to files first.

**The dev server's request path.** Vite answers any URL outside its `base` itself, with a 404. So the
framework registers a middleware ahead of Vite's: `/_static/*` falls through to Vite, everything else is a
`Request` for the RSC entry, loaded through the module runner per request.

**One built app per process.** The plugin's runtime keeps its module loaders on `globalThis`. Two builds
evaluated in one process overwrite each other's; that is never a deployment, but it is what several suites
used to do, so `importAppBundle` now imports each build from a private copy.

## Known to be weaker, or unverified

- **`cannotLoadServerActions` is an approximation now.** For a form post that does not name its action, it
  probes _an_ action. Under Rspack every action lived in one module, so that was exact; each `'use server'`
  module is its own chunk here.
- **Inline actions that close over scope** (`'use server'` in a function body with bound arguments) were not
  supported before and have not been tried here. The plugin has the machinery for it; nothing in the suite
  exercises it.
- **CSP.** The existing CSP cases pass, in both suites. Not separately examined: whether every tag Vite's
  own preload helper injects for a lazily loaded client chunk carries the nonce under a strict policy.
- **`globalThis.process` in a client component** still cannot be shadowed, as before; the build warns.
- **Real hosts.** `cloudflare` was checked with `wrangler deploy --dry-run`; `vercel` and `aws-lambda` by the
  suite's in-process drivers. None was deployed.

## Still open from the design

The design this followed (ADR-001 … ADR-012) asked for more than a bundler swap. Not done:

- **React 19.3.1+** (ADR-005). The pin stayed on 19.2.8 so that every change in this replacement could be
  attributed to the bundler. With Rspack gone nothing holds it there.
- **Navigation API only** (ADR-006 … 010, issues #29 #40 #78 – #81 #85 #87). The History fallback, the
  `SnapshotRegistry`-centred history model, commit-synchronised `finished` and the rest of the navigation
  redesign are untouched: `entry.client.tsx` changed by its imports and its dev client, nothing else.
- **`hydrateRoot(document)` in a transition, `onCaughtError` / `onUncaughtError`** — as they were.
- **Re-running the benchmarks.**
