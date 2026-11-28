/**
 * CPU time a process tree has used, from `/proc`. Linux only; elsewhere `null`, and the rows that need it are
 * left out rather than estimated.
 *
 * Requests per second says how fast a server answered on this machine. CPU milliseconds per request says what
 * each answer *cost*, which is the figure that carries to a machine with a different number of cores and the
 * one a bill is made of.
 */
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

let ticksPerSecond;
function clockTicks() {
  if (ticksPerSecond === undefined) {
    try {
      ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
    } catch {
      ticksPerSecond = 100;
    }
  }
  return ticksPerSecond;
}

/** `pid → { ppid, cpuMs }` for every process, read in one pass. */
async function processes() {
  const table = new Map();
  let entries;
  try {
    entries = await readdir('/proc');
  } catch {
    return null;
  }
  await Promise.all(
    entries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        try {
          const stat = await readFile(`/proc/${name}/stat`, 'utf8');
          // The command name is in parentheses and may itself contain spaces or parentheses.
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          const ticks = Number(fields[11]) + Number(fields[12]);
          table.set(Number(name), { ppid: Number(fields[1]), cpuMs: (ticks * 1000) / clockTicks() });
        } catch {
          // Gone between the listing and the read.
        }
      }),
  );
  return table;
}

/** User + system CPU milliseconds used so far by `rootPid` and everything under it. */
export async function treeCpuMs(rootPid) {
  const table = await processes();
  if (!table?.has(rootPid)) return null;
  const children = new Map();
  for (const [pid, { ppid }] of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    total += table.get(pid)?.cpuMs ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}
