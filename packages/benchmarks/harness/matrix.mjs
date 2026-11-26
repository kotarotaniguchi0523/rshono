/**
 * The same servers, under more than one condition (`lib/environments.mjs`).
 *
 * `load.mjs` drives each server once, with every core to itself. That answers "is anything pathological", and
 * it is the condition a deployed server is least likely to be in. This runs three questions per environment:
 *
 * 1. **What does one request cost when nothing else is happening?** Sequential requests, sampled in batches
 *    sized so each batch is long enough to time (`sample` in `lib/stats.mjs`), reported as a distribution.
 *    No queueing, no contention: the floor under every latency figure further down.
 * 2. **How does it hold as concurrency rises?** The same route at 1, 8, 32 and 128 connections — throughput,
 *    median and tail. A server whose tail grows faster than its queue is doing something per request that
 *    does not scale.
 * 3. **What did each answer cost in CPU?** Process-tree CPU time over the run, divided by requests served.
 *    Unlike requests per second it does not depend on how many cores the box has.
 *
 * And for the streamed route, when the first byte leaves against when the last one does.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { resolveTargets, ROUTES, flagValue, hasFlag } from './lib/targets.mjs';
import { indent, startServer, portFree } from './lib/proc.mjs';
import { drive } from './lib/loadgen.mjs';
import { treeRss } from './lib/rss.mjs';
import { treeCpuMs } from './lib/cpu.mjs';
import { SERVER_ENVIRONMENTS, pick } from './lib/environments.mjs';
import { describe, sample, summaryLine, median, ms, num, bytes } from './lib/stats.mjs';
import { merge } from './lib/results.mjs';

const targets = resolveTargets();
const quick = hasFlag('quick');
const environments = pick(SERVER_ENVIRONMENTS, flagValue('env', null));
const levels = flagValue('connections', quick ? '1,32' : '1,8,32,128')
  .split(',')
  .map(Number);
const durationMs = Number(flagValue('duration', quick ? '1.5' : '4')) * 1000;
const samples = Number(flagValue('samples', quick ? '5' : '10'));
/** The routes swept for concurrency: the render path, and the HTTP layer with React off it. */
const SWEPT = ['ssr', 'api'];

for (const target of targets) {
  if (!(await portFree(target.port))) {
    console.error(`✗ port ${target.port} is already answering — something is still running from a previous run.`);
    process.exit(1);
  }
}

/**
 * Keeps this process — and the load workers it starts, which inherit the mask — off the core a pinned server
 * has been given, so the driver and the server are not timing each other.
 */
function holdDriverOff(core) {
  const cores = os.cpus().length;
  const mask =
    core === null
      ? `0-${cores - 1}`
      : Array.from({ length: cores }, (_, n) => n)
          .filter((n) => n !== core)
          .join(',');
  try {
    execFileSync('taskset', ['-a', '-cp', mask, String(process.pid)], { stdio: 'ignore' });
  } catch {
    // Not Linux, or no taskset: the environments that need it were already marked unavailable.
  }
}

async function firstAndLastByte(url, runs) {
  const first = [];
  const last = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    const res = await fetch(url);
    const reader = res.body.getReader();
    await reader.read();
    first.push(performance.now() - started);
    while (!(await reader.read()).done);
    last.push(performance.now() - started);
  }
  return { firstByteMs: describe(first), lastByteMs: describe(last) };
}

const out = { settings: { levels, durationMs, samples, swept: SWEPT }, environments: {} };

for (const environment of environments) {
  console.log(`\n${'━'.repeat(72)}\n${environment.id} — ${environment.label}\n${'━'.repeat(72)}`);
  if (!environment.available) {
    console.log(`  skipped: ${environment.unavailableBecause}`);
    out.environments[environment.id] = { label: environment.label, skipped: environment.unavailableBecause, targets: {} };
    continue;
  }
  holdDriverOff(environment.pinned ? 0 : null);
  const section = {
    label: environment.label,
    heapMb: environment.heapMb,
    pinned: Boolean(environment.pinned),
    runtime: environment.runtime ?? `node ${process.versions.node}`,
    targets: {},
  };

  for (const target of targets) {
    console.log(`\n=== ${target.label} ===`);
    let server;
    try {
      server = await startServer(target, { env: environment.env, wrap: environment.wrap, start: environment.start });
    } catch (error) {
      section.targets[target.id] = { label: target.label, error: error.message };
      console.log(indent(error.message));
      continue;
    }
    const entry = { label: target.label, startupMs: server.readyMs, unloaded: {}, sweep: {}, streamed: null };
    try {
      // 1. One request at a time.
      for (const route of ROUTES) {
        const url = server.base + route.path;
        const { samples: xs, batchSize } = await sample(async () => void (await (await fetch(url)).arrayBuffer()), { samples });
        entry.unloaded[route.id] = { ...describe(xs, { batchSize, name: `${target.id} ${route.path}` }), samples: xs };
        console.log(`  ${route.path.padEnd(14)} ${summaryLine(entry.unloaded[route.id])}`);
      }

      // The streamed route: is the head sent before the body is done?
      entry.streamed = await firstAndLastByte(`${server.base}/ssr`, quick ? 10 : 30);
      console.log(`  /ssr first byte ${ms(entry.streamed.firstByteMs.median)} · last byte ${ms(entry.streamed.lastByteMs.median)}`);

      // 2 and 3. Concurrency, and what it cost.
      for (const routeId of SWEPT) {
        const route = ROUTES.find((candidate) => candidate.id === routeId);
        entry.sweep[routeId] = [];
        for (const connections of levels) {
          const cpuBefore = await treeCpuMs(server.pid);
          const result = await drive(server.base + route.path, { connections, durationMs, warmupMs: quick ? 300 : 1000 });
          const cpuAfter = await treeCpuMs(server.pid);
          const rss = await treeRss(server.pid);
          // The warm-up's requests cost CPU too, and are not in `requests`; scale by the measured share of the wall time.
          const measuredShare = durationMs / (durationMs + (quick ? 300 : 1000));
          const cpuMsPerRequest =
            cpuBefore !== null && cpuAfter !== null && result.requests ? ((cpuAfter - cpuBefore) * measuredShare) / result.requests : null;
          entry.sweep[routeId].push({
            connections: result.connections,
            rps: result.rps,
            p50: result.latencyMs.p50,
            p99: result.latencyMs.p99,
            max: result.latencyMs.max,
            requests: result.requests,
            ok: result.ok,
            problem: result.problem,
            cpuMsPerRequest,
            rssBytes: rss?.largest ?? null,
          });
          console.log(
            `  ${route.path.padEnd(12)} c=${String(result.connections).padStart(3)}  ${num(result.rps).padStart(7)} rps` +
              `  p50 ${ms(result.latencyMs.p50).padStart(7)}  p99 ${ms(result.latencyMs.p99).padStart(7)}` +
              `  cpu ${cpuMsPerRequest === null ? '—' : `${cpuMsPerRequest.toFixed(2)}ms/req`}  rss ${bytes(rss?.largest)}` +
              `${result.ok ? '' : `  ⚠ ${result.problem}`}`,
          );
        }
      }
      // The floor the sweep's medians are read against.
      entry.unloadedMedianMs = Object.fromEntries(Object.entries(entry.unloaded).map(([id, summary]) => [id, median(summary.samples)]));
    } catch (error) {
      entry.error = error.message;
      console.log(indent(error.message));
    } finally {
      await server.stop();
    }
    section.targets[target.id] = entry;
  }
  out.environments[environment.id] = section;
}
holdDriverOff(null);

await merge('matrix', out);
console.log('\nwrote results/latest.json → sections.matrix');
