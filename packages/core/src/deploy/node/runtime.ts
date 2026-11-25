import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { parsePort, SERVER_DEFAULTS } from '../../server/server-config.js';
import { onShutdown } from '../../server/shutdown.js';
import type { DeployRuntime } from '../contract.js';
import { fileSystemRuntime } from '../filesystem.js';

/** Bound to every interface — so the address printed on start is `localhost`, not this. */
const WILDCARD_HOST = '0.0.0.0';

/** How long a graceful stop waits for in-flight requests before the process is ended anyway. */
const DRAIN_TIMEOUT_MS = 3000;

/**
 * The address to listen on: an explicit override (the dev server, which picks the port for its worker) beats
 * `PORT` / `HOST`, which beat the built-in default. `??` rather than `||`, so an explicit `PORT=0` — "any free
 * port" — is honoured, and so that {@link parsePort} is never consulted for a port the override already won.
 */
function listenAddress(): { port: number; hostname: string } {
  return {
    port: parsePort(process.env.PORT, 'PORT') ?? SERVER_DEFAULTS.port,
    hostname: process.env.HOST ?? SERVER_DEFAULTS.host,
  };
}

/**
 * Node: a long-lived process that owns its own port, with a filesystem behind every asset — the shape the
 * framework was built against.
 *
 * Anything that runs a Node process runs this build, Bun and Deno included: the listener is
 * `@hono/node-server`, and both implement the `node:` APIs it needs.
 */
export const runtime: DeployRuntime = {
  ...fileSystemRuntime,

  serveApp(app: Hono): undefined {
    // The prerender pass renders through `app.fetch` directly, and a bound port would keep the build alive.
    if (process.env.RSHONO_PRERENDER) return;

    const address = listenAddress();
    const server = serve({ fetch: app.fetch, ...address }, (info) => {
      const host = address.hostname === WILDCARD_HOST ? 'localhost' : address.hostname;
      console.log(`  ➜ rshono serving on http://${host}:${info.port}`);
    });

    // Stop accepting connections, let the in-flight ones finish, then exit — or exit anyway at the bound.
    onShutdown(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), DRAIN_TIMEOUT_MS).unref();
    });
  },
};
