---
title: Getting started
description: Scaffold an app, run the dev server, ship a production build.
---

rsvhono is a web framework built on [Hono](https://hono.dev), [Vite](https://vite.dev) and
[React Server Components](https://react.dev/reference/rsc/server-components). One required file
(`src/routes.ts`), one optional file (`src/server.ts`), nine exported values.

> **Alpha.** Built on `@vitejs/plugin-rsc`, which has not reached 1.0, and on React's RSC runtime
> (`react-server-dom-webpack`), which has to match `react` to the patch. All are pinned to exact versions, so
> a release of rsvhono is what moves them.

## Scaffold

```bash
npx @rsvhono/create@latest my-app
```

The runner you use is the package manager the project gets — read from `npm_config_user_agent`, written
into `packageManager`, and used for the install. `--pm npm|pnpm|yarn|bun` overrides the guess.

The scaffolder asks for a deploy target, a styling choice and a formatter/linter preset. Every question
is also a flag, and a non-interactive terminal implies `--yes`:

```bash
npx @rsvhono/create@latest my-app -y --deploy cloudflare --tailwind --quality biome
```

## Commands

```bash
rsvhono dev     # dev server with HMR (default port 3000)
rsvhono build   # production build: client + server bundles + prerendered pages
rsvhono start   # run the production build
```

`rsvhono dev` always runs the Node dev server, whatever deploy target you picked. The target is a
property of the build, not of developing.

## Requirements

- **Node ≥ 22.18** — worker threads, `process.loadEnvFile`, `Promise.withResolvers`, `URL.parse`, and
  native TypeScript stripping, so a `.ts` config needs no loader.
- **React ≥ 19.1** — the floor the RSC runtime requires.

## Next

- [Project layout](/docs/project-layout) — what the framework knows about.
- [Routing](/docs/routing) — the one required file.
- [Pages](/docs/pages) — how a server component becomes a page.
- [API reference](/docs/api) — every export.
