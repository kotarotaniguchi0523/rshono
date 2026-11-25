import type { Hono } from 'hono';
import { cpSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBuilder } from 'vite';
import { BUILD_OUT_DIR, createViteConfig } from '../builder/vite-config.js';
import type { RsvhonoConfig } from '../config.js';
import { writeBuildMarker } from '../deploy/build-marker.js';
import type { DeployPreset } from '../deploy/presets.js';
import type { Route } from '../router.js';
import { prerenderStaticRoutes } from '../server/ssg.js';
import { exit } from './exit.js';

interface BuildOptions {
  rootDir: string;
  config: RsvhonoConfig;
  /** The platform to build for, already resolved from the flag, the environment and the config. */
  preset: DeployPreset;
}

/** What `rsvhono build` uses the app's own server bundle for, once it has compiled it. */
interface ServerBundle {
  app: Hono;
  routes: readonly Route[];
  /** Resolves every route's own module, and the app's server actions, and checks them — see `checkAppModules`. */
  checkAppModules: () => Promise<void>;
}

function importServerBundle(distDir: string): Promise<ServerBundle> {
  return import(pathToFileURL(join(distDir, 'server', 'main.mjs')).href) as Promise<ServerBundle>;
}

export async function buildCommand(options: BuildOptions): Promise<void> {
  const { rootDir, config, preset } = options;
  const distDir = join(rootDir, BUILD_OUT_DIR);

  console.log('  • building client + server bundles…');
  // Emptied here rather than by Vite: the SSR environment's output sits inside the RSC environment's.
  await rm(join(distDir, 'server'), { recursive: true, force: true });
  await rm(join(distDir, 'static'), { recursive: true, force: true });
  // Outside the `try`: what this throws is a one-line `[rsvhono]` message about the app, for the CLI to print.
  const viteConfig = createViteConfig({ rootDir, isDev: false, config, preset });
  try {
    const builder = await createBuilder(viteConfig);
    await builder.buildApp();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return exit(1);
  }

  const publicDir = join(rootDir, 'public');
  // From scratch, and unconditionally, like every other directory this build assembles. `cpSync` only
  // adds, so a file deleted from `public/` used to survive in `dist/public` and go on being served by
  // `rsvhono start` for good — and deleting `public/` outright left the whole of the old tree there, since
  // the copy below is the only thing that touches it. The two CDN presets clear their own output but read
  // *this* directory, so a stale file propagated into their assets as well, past a comment promising it
  // could not.
  const distPublicDir = join(distDir, 'public');
  await rm(distPublicDir, { recursive: true, force: true });
  let servedPublicDir: string | null = null;
  if (existsSync(publicDir)) {
    servedPublicDir = distPublicDir;
    cpSync(publicDir, distPublicDir, { recursive: true });
    console.log('  • copied public/ into dist/public (served at /)');
  }

  const ssgDir = join(distDir, 'ssg');
  await rm(ssgDir, { recursive: true, force: true });
  process.env.RSVHONO_PRERENDER = '1';
  // The bundle's module scope is where `src/routes.ts` and `src/server.ts` are validated.
  //
  // This and the two stages below are what the *app* can fail — the two entry modules here, each route's own
  // module next, and a page that throws while prerendering after that. Each raises a `[rsvhono]` message
  // written for whoever is running the build, and `main().catch` in `cli/index.ts` is what prints it as the
  // one line it is. These used to be wrapped in a `phase()` helper that did the same thing three times and
  // nowhere else, which left `createConfigs` above — where a missing `src/routes.ts` is found — printing a
  // raw `Error` object with framework frames in it.
  const bundle = await importServerBundle(distDir);

  // Before anything is rendered: the checks here are the ones a route fails on *every* request, so a build
  // that skipped them would spend the prerender pass on a route it is about to refuse anyway. Without this
  // they ran on first request instead, which meant a page that could never work shipped behind a green build.
  await bundle.checkAppModules();

  const { written, skipped, flightOnly } = await prerenderStaticRoutes({
    routes: bundle.routes,
    fetch: (request) => bundle.app.fetch(request),
    ssgDir,
    siteUrl: config.siteUrl,
  });
  if (written.length > 0) {
    // Marked per page rather than counted separately, so the line answers the question a reader has about
    // each name in it: is this page served from disk? A page under a CSP nonce is half of one — its flight
    // payload is, its document is re-rendered per request — and saying "prerendered" alone would claim more
    // than the build did. The warning above says why, once.
    const nonced = new Set(flightOnly);
    const label = (path: string) => (nonced.has(path) ? `${path} (flight only)` : path);
    console.log(`  • prerendered ${written.length} static page(s): ${written.map(label).join(', ')}`);
  }
  if (skipped.length > 0) console.log(`  • skipped ${skipped.length} (will SSR per request)`);

  // Before `finalize`, so a preset that copies `dist/` into a platform layout takes it along.
  writeBuildMarker(distDir, preset.name);

  // Last, so a preset arranging its output finds every piece of the build on disk.
  await preset.finalize?.({
    rootDir,
    distDir,
    staticDir: join(distDir, 'static'),
    publicDir: servedPublicDir,
    ssgDir,
    routes: bundle.routes,
  });

  console.log(`  ✓ build complete — ${preset.deployHint}`);

  // The bundler's worker pool can keep the loop alive after the build, so the exit is explicit. {@link exit}
  // drains first: in CI the tail is the lines saying what was built and where it went.
  await exit(0);
}
