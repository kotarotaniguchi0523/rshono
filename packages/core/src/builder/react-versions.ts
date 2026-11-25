/**
 * The one dependency check the framework makes on an app: that `react`, `react-dom` and the RSC runtime are
 * the same build.
 *
 * React Server Components couple the three across bundles — `react-server-dom-webpack` reaches into
 * `ReactSharedInternals` and emits a flight payload the *matching* `react-dom` has to parse — so a split
 * resolution is not version skew to be tolerated. It is a crash inside minified React at render time, with
 * nothing in the message pointing at the cause.
 *
 * The monorepo prevents it with `overrides` in `pnpm-workspace.yaml` and `packages/create` pins both exactly
 * for the same reason, because a generated app has no overrides to rely on. Neither helps an app that grew
 * past its scaffold, which is why the check lives here — on the one path every `dev` and `build` takes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The version of `name` as a module under `from` resolves it: the nearest `node_modules/<name>` walking up.
 * Read off disk rather than through `require`, which also consults `NODE_PATH` and the global folders — and
 * the bundler does not, so a copy found only there is not the one a build would use.
 */
function installedVersion(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    try {
      return (JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')) as { version?: string }).version;
    } catch {
      if (dirname(dir) === dir) return undefined;
    }
  }
}

/**
 * Fails the build unless `react`, `react-dom` and `react-server-dom-webpack` resolve to one version.
 *
 * The first two are the app's, resolved from its root. The third is the framework's own dependency — the copy
 * `@vitejs/plugin-rsc` compiles in, since it prefers an installed `react-server-dom-webpack` to the one it
 * vendors — and it is pinned exactly, so it is also the React this release was tested with.
 *
 * @param rootDir - The project root, so resolution follows the *app's* `node_modules` rather than the
 *   framework's.
 */
export function checkReactVersions(rootDir: string): void {
  const react = installedVersion(rootDir, 'react');
  const reactDom = installedVersion(rootDir, 'react-dom');
  // Missing altogether is the resolver's to report, against the import that needed it and with the path.
  if (!react || !reactDom) return;
  const runtime = installedVersion(import.meta.dirname, 'react-server-dom-webpack');

  if (react === reactDom && (!runtime || runtime === react)) return;
  throw new Error(
    `[rsvhono] react ${react}, react-dom ${reactDom}${runtime ? ` and react-server-dom-webpack ${runtime}` : ''} resolve to different versions.\n` +
      '  React Server Components couple them: the RSC runtime reaches into React internals and emits a payload the ' +
      'matching react-dom parses, so a split resolution fails inside React while rendering rather than here.\n' +
      (runtime
        ? `  Install react and react-dom at exactly ${runtime}, the version this rsvhono carries its RSC runtime for. `
        : '  Install both at the same version. ') +
      'If a transitive dependency is what split them, pin them — `overrides` in npm, `pnpm.overrides` in pnpm, `resolutions` in yarn.',
  );
}
