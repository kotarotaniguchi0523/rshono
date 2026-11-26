/**
 * The report's sections for results taken under more than one condition: the at-a-glance grid, the server
 * matrix and the browser profiles. Kept apart from `report.mjs`, whose sections are one table per stage.
 */
import { ROUTES } from './targets.mjs';
import { bytes, geomean, isTie, num, ratio, ratioCell } from './stats.mjs';

/** Milliseconds with enough digits to tell two fast things apart, which the coarser `ms()` rounds together. */
export function fine(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} s`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (v >= 100) return `${v.toFixed(0)} ms`;
  if (v >= 10) return `${v.toFixed(1)} ms`;
  return `${v.toFixed(2)} ms`;
}

function table(header, rows) {
  const widths = header.map((h, i) => Math.max(String(h).length, ...rows.map((row) => String(row[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(header), `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`, ...rows.map(line)].join('\n');
}

/** `mean ± σ (min … max)` — the distribution in one cell, after `moon bench`. */
const spread = (summary, unit = fine) =>
  summary ? `${unit(summary.mean)} ± ${unit(summary.std_dev)} (${unit(summary.min)} … ${unit(summary.max)})` : '—';

// ── The grid ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every timed measurement as a multiple of the reference target's, with the interval the samples support.
 * Lower is better throughout. Sizes are listed separately and never folded into a mean of times.
 */
export function gridSection(sections, ids, labels) {
  const reference = ids[0];
  const timed = [];
  const sized = [];

  for (const [environmentId, environment] of Object.entries(sections.matrix?.environments ?? {})) {
    if (environment.skipped) continue;
    for (const route of ROUTES) {
      const samplesOf = (id) => environment.targets[id]?.unloaded?.[route.id]?.samples;
      if (!samplesOf(reference)) continue;
      timed.push({
        group: `Server, one request at a time — ${environment.label}`,
        name: `\`${route.path}\``,
        key: `${environmentId}/${route.id}`,
        samplesOf,
      });
    }
    for (const [routeId, levels] of Object.entries(environment.targets[reference]?.sweep ?? {})) {
      const top = levels.at(-1);
      if (!top) continue;
      const route = ROUTES.find((candidate) => candidate.id === routeId);
      const valueOf = (id) => environment.targets[id]?.sweep?.[routeId]?.find((level) => level.connections === top.connections && level.ok);
      timed.push({
        group: `Server, CPU per request at ${top.connections} connections — ${environment.label}`,
        name: `\`${route.path}\``,
        pointOf: (id) => valueOf(id)?.cpuMsPerRequest ?? null,
      });
      timed.push({
        group: `Server, 99th-percentile latency at ${top.connections} connections — ${environment.label}`,
        name: `\`${route.path}\``,
        pointOf: (id) => valueOf(id)?.p99 ?? null,
      });
    }
  }

  const BROWSER_TIMED = [
    ['fcp', 'first contentful paint'],
    ['lcp', 'largest contentful paint'],
    ['scriptMs', 'main-thread script time'],
    ['hydrated', 'hydrated'],
    ['clickToPaint', 'click → paint'],
    ['keystrokeToPaint', 'keystroke → paint'],
    ['mutation', 'mutation round trip'],
    ['navigation', 'soft navigation to `/ssr`'],
  ];
  const BROWSER_SIZED = [
    ['bytes', 'bytes on the wire (gzip)'],
    ['jsBytes', 'of which JavaScript'],
    ['heapBytes', 'JS heap after GC'],
    ['navigationBytes', 'soft navigation, bytes'],
    ['mutationBytes', 'mutation, bytes'],
  ];
  for (const profile of Object.values(sections.browser?.profiles ?? {})) {
    for (const pageId of ['home', 'ssr', 'interactive']) {
      const page = ROUTES.find((candidate) => candidate.id === pageId);
      const metricOf = (id, key) => profile.targets[id]?.pages?.[pageId]?.[key];
      for (const [key, label] of BROWSER_TIMED) {
        if (!metricOf(reference, key)?.samples) continue;
        timed.push({ group: `Browser — ${profile.label}`, name: `\`${page.path}\` ${label}`, samplesOf: (id) => metricOf(id, key)?.samples });
      }
      for (const [key, label] of BROWSER_SIZED) {
        if (!metricOf(reference, key)?.samples) continue;
        sized.push({ group: `Browser — ${profile.label}`, name: `\`${page.path}\` ${label}`, pointOf: (id) => metricOf(id, key)?.median ?? null });
      }
    }
  }
  if (!timed.length && !sized.length) return [];

  const lines = ['## At a glance', ''];
  lines.push(
    `Every measurement below as a multiple of ${labels[0]}'s, which is **1×** by construction — it is the reference because this is its repository, not because it is the baseline anyone should hold. ` +
      'These were measured by the project that maintains one of the four; read them with that in mind, and re-run them.',
    '',
    'Lower is better in every row. Where the samples support one, the ratio carries a 95% bootstrap interval: `1.25× [1.18, 1.31]` is a difference, `1.04× [0.96, 1.12]` is not, and is marked `≈`. ' +
      'The last row of each group is the geometric mean of the rows above it — the mean under which twice as slow in one place and twice as fast in another comes out even.',
    '',
  );

  const cellFor = (row, id) => {
    if (id === reference) return { text: '1×', value: 1 };
    if (row.samplesOf) {
      const r = ratio(row.samplesOf(id), row.samplesOf(reference));
      return r ? { text: `${isTie(r) ? '≈ ' : ''}${ratioCell(r)}`, value: r.ratio } : { text: '—', value: null };
    }
    const mine = row.pointOf(id);
    const base = row.pointOf(reference);
    return mine && base ? { text: `${(mine / base).toFixed(2)}×`, value: mine / base } : { text: '—', value: null };
  };

  const emit = (rows, heading) => {
    if (!rows.length) return;
    lines.push(`### ${heading}`, '');
    const groups = [...new Set(rows.map((row) => row.group))];
    const overall = Object.fromEntries(ids.map((id) => [id, []]));
    for (const group of groups) {
      const body = [];
      const columns = Object.fromEntries(ids.map((id) => [id, []]));
      for (const row of rows.filter((candidate) => candidate.group === group)) {
        const cells = ids.map((id) => cellFor(row, id));
        // A row only counts toward a mean if every target has a figure in it: otherwise the means are over different rows.
        if (cells.every((cell) => cell.value !== null))
          ids.forEach((id, index) => (columns[id].push(cells[index].value), overall[id].push(cells[index].value)));
        body.push([row.name, ...cells.map((cell) => cell.text)]);
      }
      body.push(['**geometric mean**', ...ids.map((id) => (columns[id].length ? `**${geomean(columns[id]).toFixed(2)}×**` : '—'))]);
      lines.push(`**${group}**`, '', table(['', ...labels], body), '');
    }
    if (groups.length > 1) {
      lines.push(
        table(
          [`All ${rows.length} rows`, ...labels],
          [['geometric mean', ...ids.map((id) => (overall[id].length ? `**${geomean(overall[id]).toFixed(2)}×**` : '—'))]],
        ),
        '',
      );
    }
  };
  emit(timed, 'Time');
  emit(sized, 'Size — a separate question, and never averaged with time');
  return lines;
}

// ── Server environments ─────────────────────────────────────────────────────────────────────────────────

export function matrixSection(section, ids, labels) {
  const lines = ['## Server, by environment', ''];
  lines.push(
    'The same four builds, given different amounts of machine. `load.mjs` above runs each with every core to itself; a deployed server usually has a slice of one. ' +
      'A pinned server is held to core 0 with `taskset` and the load driver kept off that core.',
    '',
  );
  for (const environment of Object.values(section.environments)) {
    lines.push(`### ${environment.label}`, '');
    if (environment.skipped) {
      lines.push(`_Not measured on this machine: ${environment.skipped}._`, '');
      continue;
    }
    const present = ids.filter((id) => environment.targets[id] && !environment.targets[id].error);
    const names = present.map((id) => labels[ids.indexOf(id)]);
    for (const id of ids)
      if (environment.targets[id]?.error)
        lines.push(`_${labels[ids.indexOf(id)]} did not start: ${environment.targets[id].error.split('\n')[0]}_`, '');
    if (!present.length) continue;

    lines.push(
      '**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.',
      '',
    );
    lines.push(
      table(
        ['Route', ...names],
        ROUTES.map((route) => [
          `\`${route.path}\``,
          ...present.map((id) => {
            const summary = environment.targets[id].unloaded?.[route.id];
            return summary ? `${spread(summary)} · ${summary.runs} × ${summary.batch_size}` : '—';
          }),
        ]),
      ),
      '',
    );

    const streamed = present.filter((id) => environment.targets[id].streamed);
    if (streamed.length) {
      lines.push(
        table(
          ['`/ssr`, one request', ...streamed.map((id) => labels[ids.indexOf(id)])],
          [
            ['first byte (median)', ...streamed.map((id) => fine(environment.targets[id].streamed.firstByteMs.median))],
            ['last byte (median)', ...streamed.map((id) => fine(environment.targets[id].streamed.lastByteMs.median))],
          ],
        ),
        '',
      );
    }

    for (const routeId of section.settings.swept) {
      const route = ROUTES.find((candidate) => candidate.id === routeId);
      const levels = environment.targets[present[0]].sweep?.[routeId] ?? [];
      if (!levels.length) continue;
      lines.push(`**\`${route.path}\` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.`, '');
      lines.push(
        table(
          ['Connections', ...names],
          levels.map((level, index) => [
            String(level.connections),
            ...present.map((id) => {
              const mine = environment.targets[id].sweep?.[routeId]?.[index];
              if (!mine) return '—';
              if (!mine.ok) return `⚠ ${mine.problem}`;
              const cpu = mine.cpuMsPerRequest === null ? '' : ` · ${mine.cpuMsPerRequest.toFixed(2)} ms CPU`;
              return `${num(mine.rps)} rps · ${fine(mine.p50)} · ${fine(mine.p99)}${cpu}`;
            }),
          ]),
        ),
        '',
      );
    }
    const lastRoute = section.settings.swept.at(-1);
    const peak = present.map((id) =>
      Math.max(...Object.values(environment.targets[id].sweep ?? {}).flatMap((levels) => levels.map((level) => level.rssBytes ?? 0))),
    );
    if (lastRoute && peak.some(Boolean))
      lines.push(table(['', ...names], [['largest process, peak resident memory', ...peak.map((value) => (value ? bytes(value) : '—'))]]), '');
  }
  return lines;
}

// ── Browser profiles ────────────────────────────────────────────────────────────────────────────────────

const BROWSER_ROWS = [
  ['ttfb', 'time to first byte', fine],
  ['fcp', 'first contentful paint', fine],
  ['lcp', 'largest contentful paint', fine],
  ['tbt', 'total blocking time', fine],
  ['scriptMs', 'main-thread script time', fine],
  ['hydrated', 'hydrated (counter answers a click)', fine],
  ['clickToPaint', 'click → paint', fine],
  ['keystrokeToPaint', 'keystroke → paint (filter 100 rows)', fine],
  ['mutation', 'mutation round trip', fine],
  ['navigation', 'soft navigation to `/ssr`', fine],
  ['bytes', 'bytes on the wire (gzip)', (v) => bytes(Math.round(v))],
  ['jsBytes', 'of which JavaScript', (v) => bytes(Math.round(v))],
  ['requests', 'requests', (v) => String(Math.round(v))],
  ['heapBytes', 'JS heap after GC', (v) => bytes(Math.round(v))],
  ['mutationBytes', 'mutation, bytes', (v) => bytes(Math.round(v))],
  ['navigationBytes', 'soft navigation, bytes', (v) => bytes(Math.round(v))],
  ['navigationRequests', 'soft navigation, requests', (v) => String(Math.round(v))],
];
/** Exact counts and byte totals do not vary run to run; a spread on them is noise in the table. */
const EXACT = new Set(['bytes', 'jsBytes', 'requests', 'heapBytes', 'mutationBytes', 'navigationBytes', 'navigationRequests']);

export function browserSection(section, ids, labels) {
  const lines = ['## In the browser, by device', ''];
  if (section.skipped) {
    lines.push(`_Not measured: ${section.skipped}._`, '');
    return lines;
  }
  lines.push(
    `Chromium ${section.settings.chromium}, ${section.settings.runs} isolated first visits per cell — nothing cached. Throttling is applied through the DevTools protocol, to the browser only; the server is the same unthrottled process in every profile. ` +
      `Bytes are ${section.settings.wire}: no app compresses, and none is left to its server's default.`,
    '',
    'Timings are `mean ± σ (min … max)`; sizes and counts are medians.',
    '',
  );
  for (const profile of Object.values(section.profiles)) {
    lines.push(`### ${profile.label}`, '');
    const present = ids.filter((id) => profile.targets[id]?.pages);
    const names = present.map((id) => labels[ids.indexOf(id)]);
    for (const page of ['home', 'ssr', 'interactive']) {
      const route = ROUTES.find((candidate) => candidate.id === page);
      const failures = present.filter((id) => profile.targets[id].pages[page]?.error);
      lines.push(`**\`${route.path}\`**`, '');
      for (const id of failures) lines.push(`_${labels[ids.indexOf(id)]}: not measured — ${profile.targets[id].pages[page].error}_`, '');
      const rows = BROWSER_ROWS.filter(([key]) => present.some((id) => profile.targets[id].pages[page]?.[key]?.runs)).map(([key, label, unit]) => [
        label,
        ...present.map((id) => {
          const summary = profile.targets[id].pages[page]?.[key];
          if (!summary?.runs) return '—';
          return EXACT.has(key) ? unit(summary.median) : spread(summary, unit);
        }),
      ]);
      if (page === 'home') {
        rows.push([
          'soft navigation kept the document',
          ...present.map((id) =>
            profile.targets[id].pages[page]?.navigationKeptDocument === undefined
              ? '—'
              : profile.targets[id].pages[page].navigationKeptDocument
                ? 'yes'
                : 'no — it reloaded',
          ),
        ]);
      }
      lines.push(table(['', ...names], rows), '');
    }
  }
  return lines;
}
