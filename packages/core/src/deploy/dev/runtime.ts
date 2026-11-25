import type { Hono } from 'hono';
import type { DeployRuntime } from '../contract.js';
import { fileSystemRuntime } from '../filesystem.js';

/**
 * `rshono dev`: Vite owns the listener and serves every client module under `/_static/`, and every
 * other request goes to the RSC entry's default export (`configureServer` in `builder/vite-config.ts`) — which is what `serveApp` returns here. The same
 * runtime whatever the deploy target: the dev server is always a Node process on this machine.
 */
export const runtime: DeployRuntime = {
  ...fileSystemRuntime,
  mountStaticAssets() {},
  // `env` is `@hono/node-server`'s `{ incoming, outgoing }` — what the node target passes in production.
  serveApp: (app: Hono) => (request: Request, env: unknown) => app.fetch(request, env),
};
