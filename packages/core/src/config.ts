import type { UserConfig } from 'vite';
import type { DeployTarget } from './deploy/contract.js';

/**
 * Project configuration, default-exported from `rsvhono.config.ts` at the project root (`.js` / `.mjs`
 * also work). Every field is optional; omit the file entirely to accept all defaults.
 *
 * It holds only what the *build* decides. Per-request concerns — CSRF, CSP, the body cap — are Hono
 * middleware in `src/server.ts`, which is where Hono already ships all of them.
 *
 * @example
 * ```ts
 * import { defineConfig } from '@rsvhono/core';
 *
 * export default defineConfig({
 *   deploy: 'cloudflare',
 *   siteUrl: 'https://example.com',
 * });
 * ```
 *
 * @see {@link https://www.rshono.com/docs/configuration | Docs — configuration}
 */
export interface RsvhonoConfig {
  /**
   * The hosting platform `rsvhono build` targets. Default `'node'` — a long-lived server process run
   * with `rsvhono start`.
   *
   * Overridden by the `--deploy` flag or the `RSVHONO_DEPLOY` env var, so one config can build for more
   * than one place. `rsvhono dev` ignores it and always runs the Node dev server.
   *
   * @see {@link https://www.rshono.com/docs/deployment | Docs — deployment}
   */
  deploy?: DeployTarget;
  /**
   * The public origin the site is served from, e.g. `'https://example.com'`. Must be a bare origin —
   * a path is rejected rather than silently dropped.
   *
   * Only used when prerendering `render: 'static'` routes, which have no request to read a `Host`
   * from: without it their `url` prop falls back to `http://localhost`, and that is what canonical
   * tags, absolute links and `og:url` get baked with.
   *
   * @see {@link https://www.rshono.com/docs/configuration#siteurl | Docs — siteUrl}
   */
  siteUrl?: string;
  /**
   * Honour `X-Forwarded-Host` / `X-Forwarded-Proto` when resolving the browser-facing request URL —
   * `getRequestContext().url` and a page's `url` prop. Default `false`; always `true` under
   * `rsvhono dev`.
   *
   * **Enable it only behind a proxy you control**: any client can send those headers, so with nothing
   * stripping them at the edge one request can point every absolute URL the app builds at an
   * attacker's host. Turn it on when you terminate TLS or rewrite `Host` at a reverse proxy.
   *
   * Middleware in `src/server.ts` reads Hono's `c.req.url` — the *internal* address — whatever this
   * says, so give `csrf()` the public origin explicitly.
   *
   * **Compiled into the server bundle**, not read at runtime, so it takes a rebuild to change and there is
   * no environment variable for it: one artifact cannot be promoted from a direct-exposure staging box to a
   * proxied production one.
   *
   * **The `vercel` target is the exception, for the scheme only.** TLS terminates at that platform's edge
   * and the function is reached over plain HTTP, so the request is rebuilt from `X-Forwarded-Proto`
   * whatever this says — the function is reachable only through the edge, which sets the header on every
   * request, so it is not client-supplied there. The `Host` header is not part of the exception, and is no
   * more trusted on that target than on any other.
   *
   * @example
   * ```ts
   * export default defineConfig({ trustProxy: true });
   * ```
   *
   * @see {@link https://www.rshono.com/docs/configuration#proxy-headers | Docs — proxy headers}
   */
  trustProxy?: boolean;
  /**
   * Escape hatch: Vite config merged over the generated one (`mergeConfig`) — plugins, aliases, CSS options,
   * per-environment settings under `environments.{rsc,ssr,client}`. The framework's own plugins are always
   * registered; `root`, `base` and the output directories are its to set.
   *
   * @example
   * vite: { plugins: [tailwindcss()] }
   *
   * @see {@link https://vite.dev/config/ | Vite — configuration reference}
   */
  vite?: UserConfig;
}

/**
 * Types a config object for editor autocomplete, without an explicit annotation. Default-export the
 * result from `rsvhono.config.ts`.
 *
 * @param config - The project's {@link RsvhonoConfig}; every field is optional.
 * @returns The config, unchanged and fully typed.
 *
 * @example
 * ```ts
 * // rsvhono.config.ts
 * import { defineConfig } from '@rsvhono/core';
 *
 * export default defineConfig({ deploy: 'cloudflare', siteUrl: 'https://example.com' });
 * ```
 *
 * @see {@link https://www.rshono.com/docs/configuration | Docs — configuration}
 */
export function defineConfig(config: RsvhonoConfig): RsvhonoConfig {
  return config;
}
