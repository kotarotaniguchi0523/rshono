import { watch } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createServer } from 'vite';
import { createViteConfig } from '../builder/vite-config.js';
import type { RsvhonoConfig } from '../config.js';
import { NODE_PRESET } from '../deploy/presets.js';
import { SERVER_DEFAULTS } from '../server/server-config.js';
import { onShutdown } from '../server/shutdown.js';
import { exit } from './exit.js';

const DEV_HOST = '127.0.0.1';

/**
 * Files whose contents are fixed when the dev server starts: the config is read once to build the Vite
 * config, and a `.env` file is loaded into `process.env`, which `process.loadEnvFile` will not overwrite.
 */
const BAKED_IN_FILES = ['.env.local', '.env', 'rsvhono.config.ts', 'rsvhono.config.js', 'rsvhono.config.mjs'];

/** Says so, rather than leaving an edit that silently does nothing. */
function warnOnBakedInFileChanges(rootDir: string): void {
  const warnedAt = new Map<string, number>();
  try {
    watch(rootDir, { persistent: false }, (_event, filename) => {
      if (!filename || !BAKED_IN_FILES.includes(filename)) return;
      // Editors save in bursts (write, rename, chmod); one line per save is enough.
      const now = Date.now();
      if (now - (warnedAt.get(filename) ?? 0) < 250) return;
      warnedAt.set(filename, now);
      console.warn(`  ⚠ ${filename} changed — restart \`rsvhono dev\` to pick it up. It is read once, when the dev server starts.`);
    });
  } catch {
    // A platform without directory watching loses the warning, not the dev server.
  }
}

function portAvailable(port: number, hostname: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const probe = createNetServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, hostname, () => probe.close(() => resolve(true)));
  return promise;
}

interface DevOptions {
  rootDir: string;
  port?: number;
  config: RsvhonoConfig;
}

/**
 * `rsvhono dev`: one Vite dev server. It serves client modules and HMR under `/_static/`, runs the RSC and SSR
 * environments in-process, and passes every other request to the app — so there is no second port, no
 * proxy and no output directory. A client edit is Fast Refresh; a server edit re-renders the page in place.
 */
export async function devCommand(options: DevOptions): Promise<void> {
  const { rootDir, config } = options;
  const port = options.port ?? SERVER_DEFAULTS.port;

  // Refused rather than moved to the next free port: the address is what the author asked for.
  if (!(await portAvailable(port, DEV_HOST))) {
    console.error(`  ✗ port ${port} is already in use`);
    return exit(1);
  }

  const viteConfig = createViteConfig({ rootDir, isDev: true, config, preset: NODE_PRESET });
  const server = await createServer({
    ...viteConfig,
    server: { ...viteConfig.server, port, strictPort: true, host: DEV_HOST },
  });
  await server.listen();

  warnOnBakedInFileChanges(rootDir);

  const address = server.httpServer?.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  console.log(`  ➜ rsvhono dev server: http://localhost:${boundPort}`);

  onShutdown(() => {
    void server.close().finally(() => exit(0));
  });
}
