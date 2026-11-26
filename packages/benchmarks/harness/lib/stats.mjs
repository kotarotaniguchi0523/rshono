export function median(xs) {
  return percentile(xs, 50);
}

export function percentile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  // Linear interpolation between order statistics — the usual definition, and it stops p99 on a
  // 200-sample run from just being "the second largest value".
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Relative spread of the trials. Printed alongside every timing so a reader can see when a
 * difference is inside the noise — which on a laptop it usually is.
 */
export function rsd(xs) {
  const m = mean(xs);
  const s = stdev(xs);
  return m && s !== null ? (s / m) * 100 : null;
}

/**
 * `Math.min(...xs)` spreads every sample onto the call stack, and a fast route over an 8s run puts
 * hundreds of thousands of latencies in here — enough to overflow it. Loop instead.
 */
function extent(xs) {
  if (!xs.length) return { min: null, max: null };
  let min = xs[0];
  let max = xs[0];
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max };
}

export function summarize(xs) {
  const { min, max } = extent(xs);
  return {
    n: xs.length,
    min,
    p50: percentile(xs, 50),
    p90: percentile(xs, 90),
    p99: percentile(xs, 99),
    max,
    mean: mean(xs),
    stdev: stdev(xs),
    rsdPct: rsd(xs),
  };
}

export function ms(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}s`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`;
  return `${v.toFixed(v < 10 ? 2 : 0)}ms`;
}

export function bytes(v) {
  if (v === null || v === undefined) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} kB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

export function num(v, digits = 0) {
  return v === null || v === undefined ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

// ── Samples as a distribution ───────────────────────────────────────────────────────────────────────────
//
// The shape MoonBit's `moon bench` reports, and for its reason: a timing is a distribution, and a single
// figure hides whether two of them differ. Each *sample* is the mean of a batch of runs, the batch sized so
// that one batch takes long enough to time honestly; the summary is over the samples.

/**
 * Everything `@bench.Summary` carries, under the same names, so a reader who knows one reads the other:
 * `runs` samples of `batch_size` iterations each.
 */
export function describe(xs, { batchSize = 1, name } = {}) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = mean(sorted);
  const variance = sorted.length > 1 ? sorted.reduce((a, x) => a + (x - m) ** 2, 0) / (sorted.length - 1) : 0;
  const sd = Math.sqrt(variance);
  const med = percentile(sorted, 50);
  const mad = percentile(
    sorted.map((x) => Math.abs(x - med)),
    50,
  );
  const quartiles = [percentile(sorted, 25), med, percentile(sorted, 75)];
  return {
    name,
    runs: sorted.length,
    batch_size: batchSize,
    sum: sorted.reduce((a, b) => a + b, 0),
    min: sorted[0],
    max: sorted.at(-1),
    mean: m,
    median: med,
    var: variance,
    std_dev: sd,
    std_dev_pct: m ? (sd / m) * 100 : 0,
    median_abs_dev: mad,
    median_abs_dev_pct: med ? (mad / med) * 100 : 0,
    quartiles,
    iqr: quartiles[2] - quartiles[0],
  };
}

/**
 * Runs `once` in batches and returns one sample per batch (the batch's mean, in ms).
 *
 * The batch size is found the way `moon bench` finds it: doubled until one batch takes at least `minBatchMs`,
 * so a 0.2ms request is timed over hundreds of iterations and a 40ms one over a handful, and neither is at
 * the mercy of the clock or of one unlucky scheduling slice. `samples` batches are then measured.
 */
export async function sample(once, { samples = 10, minBatchMs = 100, maxBatch = 4096, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i++) await once();
  let batch = 1;
  for (;;) {
    const started = performance.now();
    for (let i = 0; i < batch; i++) await once();
    if (performance.now() - started >= minBatchMs || batch >= maxBatch) break;
    batch *= 2;
  }
  const out = [];
  for (let s = 0; s < samples; s++) {
    const started = performance.now();
    for (let i = 0; i < batch; i++) await once();
    out.push((performance.now() - started) / batch);
  }
  return { samples: out, batchSize: batch };
}

/** `21.67 ms ± 0.54 ms    21.28 ms … 23.14 ms  in 10 × 4619 runs` — one line per named benchmark. */
export function summaryLine(summary, unit = ms) {
  if (!summary) return '—';
  return `${unit(summary.mean)} ± ${unit(summary.std_dev)}   ${unit(summary.min)} … ${unit(summary.max)}  in ${summary.runs} × ${summary.batch_size} runs`;
}

/** A deterministic generator, so a report regenerated from the same samples prints the same intervals. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How many times `xs` is of `reference`, by their medians, with a 95% bootstrap interval.
 *
 * A ratio without an interval invites reading 1.04× as a result. With one, `1.04× [0.97, 1.12]` says what it
 * is: a tie. Resampled independently on each side — the two were not measured in pairs.
 */
export function ratio(xs, reference, { resamples = 2000, seed = 1 } = {}) {
  if (!xs?.length || !reference?.length) return null;
  const base = median(reference);
  if (!base) return null;
  const point = median(xs) / base;
  if (xs.length < 3 || reference.length < 3) return { ratio: point, low: null, high: null };
  const random = mulberry32(seed);
  const draw = (from) => median(Array.from({ length: from.length }, () => from[Math.floor(random() * from.length)]));
  const ratios = [];
  for (let i = 0; i < resamples; i++) {
    const denominator = draw(reference);
    if (denominator) ratios.push(draw(xs) / denominator);
  }
  return { ratio: point, low: percentile(ratios, 2.5), high: percentile(ratios, 97.5) };
}

/** The mean for ratios: the one under which "twice as slow here, twice as fast there" comes out even. */
export function geomean(values) {
  const usable = values.filter((v) => typeof v === 'number' && v > 0);
  return usable.length ? Math.exp(usable.reduce((a, v) => a + Math.log(v), 0) / usable.length) : null;
}

/** `1.25× [1.24, 1.27]`, or the bare ratio where there were too few samples for an interval. */
export function ratioCell(r) {
  if (!r) return '—';
  const x = (v) => `${v.toFixed(v < 10 ? 2 : 1)}`;
  return r.low === null ? `${x(r.ratio)}×` : `${x(r.ratio)}× [${x(r.low)}, ${x(r.high)}]`;
}

/** Whether an interval leaves room for "no difference". */
export const isTie = (r) => Boolean(r && r.low !== null && r.low <= 1 && r.high >= 1);
