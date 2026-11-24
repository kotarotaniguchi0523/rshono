import type { Hono } from 'hono';
import type { DeployRuntime } from '../contract.js';

/**
 * The runtime behind `vite dev` and `vite preview`: Vite owns the listener and serves the client assets and
 * `public/`, and `@vitejs/plugin-rsc` calls the RSC entry's default export with each `Request` that is left.
 *
 * **Not a deploy target.** There is no prerendered-page store and no static mount here; carrying the four
 * real targets (`deploy/presets.ts`) over to a Vite build is a later step of the migration.
 */
export const runtime: DeployRuntime = {
  serveApp: (app: Hono) => (request: Request) => app.fetch(request),
  mountStaticAssets() {},
  mountPublicFallback() {},
  readPrerendered: () => Promise.resolve(null),
  loadEnv() {},
};
