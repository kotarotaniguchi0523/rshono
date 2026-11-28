/**
 * The conditions a number is measured under. One machine at full strength is one condition, and the one a
 * framework's deployment is least likely to see: a server usually gets a slice of a core and a few hundred
 * megabytes, and a visitor's phone is several times slower than the laptop the page was built on. A result
 * that holds across these is a property of the framework; one that flips is a property of the machine.
 *
 * None of these changes the app or its build — only what the same artefact is given to run with.
 */
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const linux = os.platform() === 'linux';
const hasTaskset = linux && ['/usr/bin/taskset', '/bin/taskset'].some(existsSync);

/**
 * Server environments. `wrap` goes in front of the start command; `env` is merged into the server's.
 *
 * - **roomy** — every core, a 256 MB old-space budget: the harness's long-standing default.
 * - **one-core** — pinned to a single core with `taskset`, the driver on the others. The shape of a small
 *   container, and the condition that separates work done per request from work that only looks cheap
 *   because another core absorbed it (GC, stream plumbing, a worker thread).
 * - **tight-heap** — one core and a 128 MB old-space budget: where a server that allocates more per request
 *   starts paying for it in collections, not just in RSS.
 */
export const SERVER_ENVIRONMENTS = [
  { id: 'roomy', label: 'all cores, 256 MB heap', heapMb: 256 },
  { id: 'one-core', label: '1 core, 256 MB heap', heapMb: 256, pinned: true },
  { id: 'tight-heap', label: '1 core, 128 MB heap', heapMb: 128, pinned: true },
].map((environment) => ({
  ...environment,
  available: !environment.pinned || (hasTaskset && os.cpus().length > 1),
  unavailableBecause: !environment.pinned
    ? null
    : !linux
      ? 'core pinning needs Linux (taskset)'
      : !hasTaskset
        ? 'taskset is not installed'
        : 'the machine has one core',
  wrap: environment.pinned ? ['taskset', '-c', '0'] : [],
  env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${environment.heapMb}`.trim() },
}));

// ── Runtimes ────────────────────────────────────────────────────────────────────────────────────────────

const RUNTIMES_DIR = fileURLToPath(new URL('../../.runtimes/node_modules/.bin/', import.meta.url));

function versionOf(command, args = ['--version']) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .replace(/^v/, '');
  } catch {
    return null;
  }
}

const otherNode = existsSync(path.join(RUNTIMES_DIR, 'node')) ? versionOf(path.join(RUNTIMES_DIR, 'node')) : null;
const bun = versionOf('bun');

/**
 * The same builds on another JavaScript runtime. All cores, like **roomy**, so the runtime is the one thing
 * that differs from it.
 *
 * - **another Node** — whichever `pnpm --filter @rsvhono/benchmarks setup:runtimes` installed beside the
 *   harness (the current LTS line after the one running it). The build is the one the harness's own Node
 *   made; only the server runs on the other.
 * - **Bun** — `bun --bun run start`, which runs the app's start script and everything it spawns on Bun
 *   rather than on the Node its shebang names. Bun has no `--max-old-space-size`, so the heap budget the
 *   other environments share does not apply: its memory rows are not comparable to theirs and are not
 *   compared.
 *
 * Skipped, and said so, where the runtime is not installed.
 */
SERVER_ENVIRONMENTS.push(
  {
    id: 'node-other',
    label: otherNode ? `Node ${otherNode}, all cores` : 'another Node, all cores',
    heapMb: 256,
    available: Boolean(otherNode) && otherNode !== process.versions.node,
    unavailableBecause: otherNode
      ? 'it is the Node the harness is already running on'
      : 'not installed — pnpm --filter @rsvhono/benchmarks setup:runtimes',
    wrap: [],
    env: {
      PATH: `${RUNTIMES_DIR}${path.delimiter}${process.env.PATH}`,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=256`.trim(),
    },
    runtime: otherNode ? `node ${otherNode}` : null,
  },
  {
    id: 'bun',
    label: bun ? `Bun ${bun}, all cores` : 'Bun, all cores',
    heapMb: null,
    available: Boolean(bun),
    unavailableBecause: 'bun is not on PATH',
    wrap: [],
    // Bun reads NODE_OPTIONS and refuses flags it does not know; the heap flag is one of them.
    env: { NODE_OPTIONS: '' },
    start: ['bun', ['--bun', 'run', 'start']],
    runtime: bun ? `bun ${bun}` : null,
  },
);

/**
 * Browser profiles, applied through the DevTools protocol. The throttling figures are Lighthouse's, so a
 * number here can be held against anything else measured that way.
 *
 * - **desktop** — no throttling.
 * - **mid-tier mobile** — CPU 4× slower, "Slow 4G" (1.6 Mbps down, 750 kbps up, 150 ms round trip).
 * - **low-end mobile** — CPU 6× slower, "3G" (700 kbps down and up, 300 ms round trip).
 *
 * CPU throttling slows the *browser's* main thread, not the server; the server runs unthrottled in all four,
 * so what moves is what the framework asks the device to do.
 */
export const BROWSER_PROFILES = [
  { id: 'desktop', label: 'desktop, unthrottled', cpu: 1, network: null, viewport: { width: 1350, height: 940 } },
  {
    id: 'mobile-mid',
    label: 'mid-tier mobile (4× CPU, Slow 4G)',
    cpu: 4,
    network: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
    viewport: { width: 412, height: 823 },
  },
  {
    id: 'mobile-low',
    label: 'low-end mobile (6× CPU, 3G)',
    cpu: 6,
    network: { latency: 300, downloadThroughput: (700 * 1024) / 8, uploadThroughput: (700 * 1024) / 8 },
    viewport: { width: 360, height: 640 },
  },
];

export function pick(all, wanted) {
  if (!wanted) return all;
  const ids = wanted.split(',');
  const unknown = ids.filter((id) => !all.some((entry) => entry.id === id));
  if (unknown.length) throw new Error(`Unknown environment(s): ${unknown.join(', ')}. Known: ${all.map((entry) => entry.id).join(', ')}`);
  return all.filter((entry) => ids.includes(entry.id));
}
