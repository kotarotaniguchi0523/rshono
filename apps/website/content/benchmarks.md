---
title: Benchmarks
description: One app built three ways — rsvhono, Next.js and TanStack Start — measured on payload bytes, build time, cold start and install size.
---

_Generated from `packages/benchmarks` on 2026-11-26 (build, payload, coldstart, load, matrix, browser, devstart, footprint). One run, one machine. Regenerate with
`pnpm --filter @rsvhono/benchmarks bench` and `pnpm --filter @rsvhono/benchmarks site:publish`._

## Environment

| Property | Value                                                     |
| -------- | --------------------------------------------------------- |
| Machine  | Intel(R) Xeon(R) Processor @ 2.10GHz · 2 cores · 7.8 GB   |
| Platform | linux 6.18.44-fc-v880 x64                                 |
| Node     | v22.23.5                                                  |
| CI       | no — one local machine; treat spreads under ~10% as noise |

### Versions

React version skew across the three is unavoidable — Next vendors its own copy — so it is reported rather than hidden. A render-path difference of a few percent is more likely this than the framework.

| Package                    | rsvhono     | Next.js | TanStack Start |
| -------------------------- | ----------- | ------- | -------------- |
| `react`                    | 19.3.1      | 19.2.8  | 19.2.8         |
| `react-dom`                | 19.3.1      | 19.2.8  | 19.2.8         |
| `@rsvhono/core`            | 1.0.0-rc.29 | —       | —              |
| `hono`                     | 4.13.5      | —       | —              |
| `vite`                     | 8.3.8       | —       | 7.3.6          |
| `@vitejs/plugin-rsc`       | 0.5.39      | —       | —              |
| `react-server-dom-webpack` | 19.3.1      | —       | —              |
| `next`                     | —           | 16.2.12 | —              |
| `@tanstack/react-start`    | —           | —       | 1.168.33       |
| `@tanstack/react-router`   | —           | —       | 1.170.18       |

## At a glance

Every measurement below as a multiple of rsvhono's, which is **1×** by construction — it is the reference because this is its repository, not because it is the baseline anyone should hold. These were measured by the project that maintains one of the three; read them with that in mind, and re-run them.

Lower is better in every row. Where the samples support one, the ratio carries a 95% bootstrap interval: `1.25× [1.18, 1.31]` is a difference, `1.04× [0.96, 1.12]` is not, and is marked `≈`. The last row of each group is the geometric mean of the rows above it — the mean under which twice as slow in one place and twice as fast in another comes out even.

### Time

**Server, one request at a time — all cores, 256 MB heap**

|                    | rsvhono   | Next.js            | TanStack Start     |
| ------------------ | --------- | ------------------ | ------------------ |
| `/`                | 1×        | 1.76× [1.55, 2.07] | 2.27× [1.97, 2.65] |
| `/ssr`             | 1×        | 1.62× [1.44, 1.84] | 1.59× [1.42, 1.72] |
| `/interactive`     | 1×        | 2.09× [1.76, 2.53] | 1.60× [1.35, 1.95] |
| `/api/health`      | 1×        | 4.57× [3.12, 5.32] | 2.85× [1.85, 3.32] |
| **geometric mean** | **1.00×** | **2.28×**          | **2.01×**          |

**Server, CPU per request at 128 connections — all cores, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.96×     | 1.67×          |
| `/api/health`      | 1×        | 10.45×    | 3.20×          |
| **geometric mean** | **1.00×** | **4.53×** | **2.31×**      |

**Server, 99th-percentile latency at 128 connections — all cores, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.08×     | 1.12×          |
| `/api/health`      | 1×        | 8.17×     | 3.81×          |
| **geometric mean** | **1.00×** | **2.97×** | **2.06×**      |

**Server, one request at a time — 1 core, 256 MB heap**

|                    | rsvhono   | Next.js            | TanStack Start     |
| ------------------ | --------- | ------------------ | ------------------ |
| `/`                | 1×        | 2.34× [1.88, 2.74] | 3.27× [2.63, 4.20] |
| `/ssr`             | 1×        | 1.75× [1.49, 2.03] | 1.57× [1.36, 2.08] |
| `/interactive`     | 1×        | 2.47× [2.05, 2.95] | 1.82× [1.57, 2.13] |
| `/api/health`      | 1×        | 5.83× [3.51, 6.86] | 3.28× [1.95, 3.80] |
| **geometric mean** | **1.00×** | **2.77×**          | **2.35×**          |

**Server, CPU per request at 128 connections — 1 core, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 2.47×     | 1.82×          |
| `/api/health`      | 1×        | 11.09×    | 3.21×          |
| **geometric mean** | **1.00×** | **5.23×** | **2.42×**      |

**Server, 99th-percentile latency at 128 connections — 1 core, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.03×     | 1.06×          |
| `/api/health`      | 1×        | 9.55×     | 5.04×          |
| **geometric mean** | **1.00×** | **3.13×** | **2.31×**      |

**Server, one request at a time — 1 core, 128 MB heap**

|                    | rsvhono   | Next.js            | TanStack Start     |
| ------------------ | --------- | ------------------ | ------------------ |
| `/`                | 1×        | 1.77× [1.59, 2.57] | 2.97× [2.59, 4.29] |
| `/ssr`             | 1×        | 1.75× [1.56, 2.02] | 1.82× [1.44, 2.03] |
| `/interactive`     | 1×        | 2.33× [1.91, 2.84] | 1.57× [1.41, 1.84] |
| `/api/health`      | 1×        | 4.01× [3.31, 5.09] | 2.22× [1.79, 2.96] |
| **geometric mean** | **1.00×** | **2.32×**          | **2.08×**          |

**Server, CPU per request at 128 connections — 1 core, 128 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 2.32×     | 1.72×          |
| `/api/health`      | 1×        | 10.62×    | 3.18×          |
| **geometric mean** | **1.00×** | **4.97×** | **2.34×**      |

**Server, 99th-percentile latency at 128 connections — 1 core, 128 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.02×     | 1.06×          |
| `/api/health`      | 1×        | 8.65×     | 5.87×          |
| **geometric mean** | **1.00×** | **2.97×** | **2.50×**      |

**Server, one request at a time — Node 24.22.3, all cores**

|                    | rsvhono   | Next.js            | TanStack Start     |
| ------------------ | --------- | ------------------ | ------------------ |
| `/`                | 1×        | 3.02× [2.34, 3.72] | 3.64× [2.88, 4.73] |
| `/ssr`             | 1×        | 1.54× [1.42, 1.71] | 1.86× [1.59, 2.23] |
| `/interactive`     | 1×        | 2.08× [1.79, 2.37] | 1.85× [1.64, 2.29] |
| `/api/health`      | 1×        | 4.64× [3.76, 5.10] | 1.94× [1.39, 2.19] |
| **geometric mean** | **1.00×** | **2.59×**          | **2.22×**          |

**Server, CPU per request at 128 connections — Node 24.22.3, all cores**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.57×     | 2.11×          |
| `/api/health`      | 1×        | 13.44×    | 3.64×          |
| **geometric mean** | **1.00×** | **4.59×** | **2.77×**      |

**Server, 99th-percentile latency at 128 connections — Node 24.22.3, all cores**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 0.98×     | 1.08×          |
| `/api/health`      | 1×        | 9.65×     | 4.41×          |
| **geometric mean** | **1.00×** | **3.07×** | **2.19×**      |

**Server, one request at a time — Bun 1.4.4, all cores**

|                    | rsvhono   | Next.js            | TanStack Start     |
| ------------------ | --------- | ------------------ | ------------------ |
| `/`                | 1×        | 3.35× [2.89, 5.07] | 4.01× [3.37, 5.97] |
| `/ssr`             | 1×        | 2.04× [1.58, 2.40] | 1.93× [1.64, 2.32] |
| `/interactive`     | 1×        | 2.41× [2.17, 2.79] | 2.08× [1.88, 2.46] |
| `/api/health`      | 1×        | 5.72× [5.06, 6.56] | 1.60× [1.35, 1.80] |
| **geometric mean** | **1.00×** | **3.12×**          | **2.25×**          |

**Server, CPU per request at 128 connections — Bun 1.4.4, all cores**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.69×     | 1.89×          |
| `/api/health`      | 1×        | 13.95×    | 2.58×          |
| **geometric mean** | **1.00×** | **4.86×** | **2.21×**      |

**Server, 99th-percentile latency at 128 connections — Bun 1.4.4, all cores**

|                    | rsvhono   | Next.js   | TanStack Start |
| ------------------ | --------- | --------- | -------------- |
| `/ssr`             | 1×        | 1.97×     | 2.13×          |
| `/api/health`      | 1×        | 9.02×     | 1.74×          |
| **geometric mean** | **1.00×** | **4.21×** | **1.92×**      |

**Browser — desktop, unthrottled**

|                                         | rsvhono   | Next.js              | TanStack Start       |
| --------------------------------------- | --------- | -------------------- | -------------------- |
| `/` first contentful paint              | 1×        | ≈ 1.00× [0.79, 1.31] | ≈ 1.00× [0.84, 1.13] |
| `/` largest contentful paint            | 1×        | ≈ 1.00× [0.79, 1.31] | ≈ 1.00× [0.84, 1.13] |
| `/` main-thread script time             | 1×        | 1.46× [1.38, 2.10]   | 1.96× [1.72, 2.41]   |
| `/` soft navigation to `/ssr`           | 1×        | ≈ 1.19× [0.69, 1.35] | ≈ 1.18× [0.78, 1.34] |
| `/ssr` first contentful paint           | 1×        | ≈ 1.13× [0.96, 1.33] | ≈ 1.13× [0.81, 1.45] |
| `/ssr` largest contentful paint         | 1×        | ≈ 1.13× [0.96, 1.33] | ≈ 1.13× [0.81, 1.45] |
| `/ssr` main-thread script time          | 1×        | 1.58× [1.37, 1.87]   | 1.92× [1.49, 2.12]   |
| `/interactive` first contentful paint   | 1×        | ≈ 1.00× [0.90, 1.22] | ≈ 0.95× [0.90, 1.17] |
| `/interactive` largest contentful paint | 1×        | ≈ 1.00× [0.90, 1.22] | ≈ 0.95× [0.90, 1.17] |
| `/interactive` main-thread script time  | 1×        | 1.10× [1.02, 1.43]   | 1.41× [1.27, 1.88]   |
| `/interactive` hydrated                 | 1×        | 1.19× [1.02, 1.30]   | ≈ 1.12× [0.95, 1.22] |
| `/interactive` click → paint            | 1×        | ≈ 1.06× [0.78, 1.27] | ≈ 1.06× [0.83, 1.33] |
| `/interactive` keystroke → paint        | 1×        | ≈ 1.38× [0.42, 2.74] | ≈ 2.03× [0.41, 3.84] |
| `/interactive` mutation round trip      | 1×        | ≈ 0.86× [0.76, 1.07] | 0.85× [0.79, 0.99]   |
| **geometric mean**                      | **1.00×** | **1.13×**            | **1.21×**            |

**Browser — mid-tier mobile (4× CPU, Slow 4G)**

|                                         | rsvhono   | Next.js              | TanStack Start       |
| --------------------------------------- | --------- | -------------------- | -------------------- |
| `/` first contentful paint              | 1×        | ≈ 0.95× [0.94, 1.00] | ≈ 0.95× [0.92, 1.00] |
| `/` largest contentful paint            | 1×        | ≈ 0.95× [0.94, 1.00] | ≈ 0.95× [0.92, 1.00] |
| `/` main-thread script time             | 1×        | 1.93× [1.60, 2.22]   | 2.18× [2.00, 2.59]   |
| `/` soft navigation to `/ssr`           | 1×        | ≈ 0.89× [0.87, 1.03] | 1.26× [1.21, 1.43]   |
| `/ssr` first contentful paint           | 1×        | ≈ 1.02× [0.99, 1.06] | ≈ 0.99× [0.96, 1.02] |
| `/ssr` largest contentful paint         | 1×        | ≈ 1.02× [0.99, 1.06] | ≈ 0.99× [0.96, 1.02] |
| `/ssr` main-thread script time          | 1×        | 1.53× [1.21, 1.83]   | 1.74× [1.40, 2.00]   |
| `/interactive` first contentful paint   | 1×        | ≈ 0.97× [0.93, 1.02] | ≈ 0.99× [0.92, 1.04] |
| `/interactive` largest contentful paint | 1×        | ≈ 0.97× [0.93, 1.02] | ≈ 0.99× [0.92, 1.04] |
| `/interactive` main-thread script time  | 1×        | 1.35× [1.21, 1.61]   | 1.80× [1.57, 2.24]   |
| `/interactive` hydrated                 | 1×        | 1.45× [1.40, 1.49]   | 1.28× [1.24, 1.31]   |
| `/interactive` click → paint            | 1×        | ≈ 1.20× [0.95, 1.49] | ≈ 1.03× [0.88, 1.68] |
| `/interactive` keystroke → paint        | 1×        | ≈ 1.01× [0.73, 1.39] | ≈ 1.06× [0.73, 1.43] |
| `/interactive` mutation round trip      | 1×        | ≈ 0.97× [0.94, 1.10] | ≈ 0.97× [0.92, 1.14] |
| **geometric mean**                      | **1.00×** | **1.13×**            | **1.18×**            |

**Browser — low-end mobile (6× CPU, 3G)**

|                                         | rsvhono   | Next.js              | TanStack Start       |
| --------------------------------------- | --------- | -------------------- | -------------------- |
| `/` first contentful paint              | 1×        | ≈ 1.01× [0.96, 1.06] | ≈ 1.01× [0.96, 1.06] |
| `/` largest contentful paint            | 1×        | ≈ 1.01× [0.96, 1.06] | ≈ 1.01× [0.96, 1.06] |
| `/` main-thread script time             | 1×        | 1.79× [1.32, 1.98]   | 1.98× [1.79, 2.21]   |
| `/` soft navigation to `/ssr`           | 1×        | 1.02× [1.01, 1.04]   | 1.05× [1.03, 1.08]   |
| `/ssr` first contentful paint           | 1×        | ≈ 1.01× [0.94, 1.03] | ≈ 1.04× [0.95, 1.05] |
| `/ssr` largest contentful paint         | 1×        | ≈ 1.01× [0.94, 1.03] | ≈ 1.04× [0.95, 1.05] |
| `/ssr` main-thread script time          | 1×        | 1.57× [1.17, 1.73]   | 2.20× [1.60, 2.35]   |
| `/interactive` first contentful paint   | 1×        | ≈ 0.99× [0.97, 1.03] | ≈ 1.01× [0.98, 1.05] |
| `/interactive` largest contentful paint | 1×        | ≈ 0.99× [0.97, 1.03] | ≈ 1.01× [0.98, 1.05] |
| `/interactive` main-thread script time  | 1×        | 1.35× [1.07, 1.50]   | 1.63× [1.29, 1.84]   |
| `/interactive` hydrated                 | 1×        | 1.48× [1.46, 1.53]   | 1.25× [1.22, 1.28]   |
| `/interactive` click → paint            | 1×        | ≈ 1.19× [0.96, 1.36] | ≈ 1.03× [0.89, 1.53] |
| `/interactive` keystroke → paint        | 1×        | ≈ 1.11× [0.82, 1.19] | ≈ 1.07× [0.87, 1.22] |
| `/interactive` mutation round trip      | 1×        | ≈ 0.99× [0.97, 1.03] | ≈ 1.01× [0.99, 1.03] |
| **geometric mean**                      | **1.00×** | **1.16×**            | **1.19×**            |

| All 82 rows    | rsvhono   | Next.js   | TanStack Start |
| -------------- | --------- | --------- | -------------- |
| geometric mean | **1.00×** | **1.89×** | **1.62×**      |

### Size — a separate question, and never averaged with time

**Browser — desktop, unthrottled**

|                                         | rsvhono   | Next.js   | TanStack Start |
| --------------------------------------- | --------- | --------- | -------------- |
| `/` bytes on the wire (gzip)            | 1×        | 1.83×     | 1.37×          |
| `/` of which JavaScript                 | 1×        | 1.80×     | 1.37×          |
| `/` JS heap after GC                    | 1×        | 1.36×     | 1.19×          |
| `/` soft navigation, bytes              | 1×        | —         | 6.93×          |
| `/ssr` bytes on the wire (gzip)         | 1×        | 1.79×     | 1.82×          |
| `/ssr` of which JavaScript              | 1×        | 1.80×     | 1.37×          |
| `/ssr` JS heap after GC                 | 1×        | 1.31×     | 1.20×          |
| `/interactive` bytes on the wire (gzip) | 1×        | 1.81×     | 1.53×          |
| `/interactive` of which JavaScript      | 1×        | 1.79×     | 1.38×          |
| `/interactive` JS heap after GC         | 1×        | 1.26×     | 1.15×          |
| `/interactive` mutation, bytes          | 1×        | 0.15×     | 0.14×          |
| **geometric mean**                      | **1.00×** | **1.28×** | **1.08×**      |

**Browser — mid-tier mobile (4× CPU, Slow 4G)**

|                                         | rsvhono   | Next.js   | TanStack Start |
| --------------------------------------- | --------- | --------- | -------------- |
| `/` bytes on the wire (gzip)            | 1×        | 1.85×     | 1.37×          |
| `/` of which JavaScript                 | 1×        | 1.80×     | 1.37×          |
| `/` JS heap after GC                    | 1×        | 1.36×     | 1.20×          |
| `/` soft navigation, bytes              | 1×        | 1.00×     | 6.93×          |
| `/ssr` bytes on the wire (gzip)         | 1×        | 1.80×     | 1.82×          |
| `/ssr` of which JavaScript              | 1×        | 1.80×     | 1.37×          |
| `/ssr` JS heap after GC                 | 1×        | 1.32×     | 1.21×          |
| `/interactive` bytes on the wire (gzip) | 1×        | 1.81×     | 1.53×          |
| `/interactive` of which JavaScript      | 1×        | 1.79×     | 1.38×          |
| `/interactive` JS heap after GC         | 1×        | 1.25×     | 1.16×          |
| `/interactive` mutation, bytes          | 1×        | 0.15×     | 0.14×          |
| **geometric mean**                      | **1.00×** | **1.25×** | **1.28×**      |

**Browser — low-end mobile (6× CPU, 3G)**

|                                         | rsvhono   | Next.js   | TanStack Start |
| --------------------------------------- | --------- | --------- | -------------- |
| `/` bytes on the wire (gzip)            | 1×        | 1.85×     | 1.37×          |
| `/` of which JavaScript                 | 1×        | 1.80×     | 1.37×          |
| `/` JS heap after GC                    | 1×        | 1.36×     | 1.20×          |
| `/` soft navigation, bytes              | 1×        | 1.00×     | 6.93×          |
| `/ssr` bytes on the wire (gzip)         | 1×        | 1.74×     | 1.82×          |
| `/ssr` of which JavaScript              | 1×        | 1.80×     | 1.37×          |
| `/ssr` JS heap after GC                 | 1×        | 1.27×     | 1.21×          |
| `/interactive` bytes on the wire (gzip) | 1×        | 1.81×     | 1.53×          |
| `/interactive` of which JavaScript      | 1×        | 1.79×     | 1.38×          |
| `/interactive` JS heap after GC         | 1×        | 1.25×     | 1.16×          |
| `/interactive` mutation, bytes          | 1×        | 0.15×     | 0.14×          |
| **geometric mean**                      | **1.00×** | **1.24×** | **1.28×**      |

| All 33 rows    | rsvhono   | Next.js   | TanStack Start |
| -------------- | --------- | --------- | -------------- |
| geometric mean | **1.00×** | **1.26×** | **1.22×**      |

## Initial-load payload

Brotli-compressed bytes the browser is committed to fetching before the route is interactive: the document, the inline flight payload, and every statically referenced script and stylesheet. Compression is applied by the harness, identically for all three.

### `/` — prerendered

| Metric              | rsvhono           | Next.js            | TanStack Start    |
| ------------------- | ----------------- | ------------------ | ----------------- |
| Document (br)       | 1.2 kB            | 1.7 kB             | 1.1 kB            |
| Inline script (raw) | 3.4 kB            | 5.7 kB             | 1.3 kB            |
| External JS (br)    | 70.1 kB · 2 files | 160.0 kB · 9 files | 97.2 kB · 2 files |
| CSS (br)            | 615 B · 1         | 615 B · 1          | 611 B · 1         |
| **Total (br)**      | **71.9 kB**       | **162.3 kB**       | **98.8 kB**       |
| Total (raw)         | 267.1 kB          | 627.8 kB           | 356.6 kB          |
| Requests            | 4                 | 11                 | 4                 |
| Spec checks         | ✓                 | ✓                  | ✓                 |

### `/ssr` — dynamic

| Metric              | rsvhono           | Next.js            | TanStack Start    |
| ------------------- | ----------------- | ------------------ | ----------------- |
| Document (br)       | 4.7 kB            | 5.2 kB             | 5.3 kB            |
| Inline script (raw) | 36.3 kB           | 38.9 kB            | 37.4 kB           |
| External JS (br)    | 70.1 kB · 2 files | 160.0 kB · 9 files | 97.0 kB · 2 files |
| CSS (br)            | 615 B · 1         | 615 B · 1          | 611 B · 1         |
| **Total (br)**      | **75.4 kB**       | **165.8 kB**       | **102.9 kB**      |
| Total (raw)         | 312.4 kB          | 673.4 kB           | 404.3 kB          |
| Requests            | 4                 | 11                 | 4                 |
| Spec checks         | ✓                 | ✓                  | ✓                 |

### `/interactive` — dynamic

| Metric              | rsvhono           | Next.js             | TanStack Start    |
| ------------------- | ----------------- | ------------------- | ----------------- |
| Document (br)       | 3.2 kB            | 3.7 kB              | 3.9 kB            |
| Inline script (raw) | 14.5 kB           | 17.6 kB             | 15.7 kB           |
| External JS (br)    | 70.8 kB · 3 files | 160.9 kB · 10 files | 98.5 kB · 4 files |
| CSS (br)            | 615 B · 1         | 615 B · 1           | 611 B · 1         |
| **Total (br)**      | **74.6 kB**       | **165.2 kB**        | **102.9 kB**      |
| Total (raw)         | 282.7 kB          | 644.7 kB            | 376.6 kB          |
| Requests            | 5                 | 12                  | 6                 |
| Spec checks         | ✓                 | ✓                   | ✓                 |

### `/api/health` — json

| Metric              | rsvhono       | Next.js       | TanStack Start |
| ------------------- | ------------- | ------------- | -------------- |
| Document (br)       | 32 B          | 32 B          | 32 B           |
| Inline script (raw) | 0 B           | 0 B           | 0 B            |
| External JS (br)    | 0 B · 0 files | 0 B · 0 files | 0 B · 0 files  |
| CSS (br)            | 0 B · 0       | 0 B · 0       | 0 B · 0        |
| **Total (br)**      | **32 B**      | **32 B**      | **32 B**       |
| Total (raw)         | 28 B          | 28 B          | 28 B           |
| Requests            | 1             | 1             | 1              |
| Spec checks         | ✓             | ✓             | ✓              |

## Build

Median of 3 trials. Cold clears the framework's cache directory first; warm keeps it and touches one source file the interactive route imports.

| Metric        | rsvhono   | Next.js    | TanStack Start |
| ------------- | --------- | ---------- | -------------- |
| Cold build    | 1.26s ±2% | 7.88s ±16% | 6.88s ±3%      |
| Warm rebuild  | 1.23s ±4% | 7.81s ±2%  | 6.87s ±2%      |
| Build output  | 1.98 MB   | 5.92 MB    | 1.57 MB        |
| Output files  | 35        | 198        | 30             |
| Server bundle | 95.1 kB   | —          | 804.3 kB       |

## Cold start

Process spawn to first answered request, fresh process each trial. Not a real serverless cold start — no container, no network — it isolates the JavaScript the framework has to parse and run before it can respond.

| Metric                 | rsvhono    | Next.js   | TanStack Start |
| ---------------------- | ---------- | --------- | -------------- |
| Spawn → first response | 277ms ±11% | 495ms ±2% | 799ms ±3%      |
| Server bundle          | 95.1 kB    | —         | 804.3 kB       |

## Throughput

32 connections, 8s per route after a 2s warmup, driven by the harness's own Node load generator.

**Read this as a floor check, not a headline.** All three render through the same React and stream through the same react-dom, so a large gap would mean an HTTP layer is pathological rather than that one framework renders faster. The in-process driver is identically handicapping for all three, and its absolute rps is a lower bound. `/api/health` is the informative row: no React on the path, so it is router and response construction alone.

All three put React server components on the request path for `/ssr` and `/interactive` (APP_SPEC.md rule 8), so those two rows compare implementations of one architecture. They are not a perfect match: rsvhono and Next encode and decode the whole document, TanStack Start only the route body its RSC helpers wrap — its shell and nav stay on the cheaper non-RSC path. The flight round trip dominates both rows; on `/ssr` it is roughly 85% of the request.

### `/`

| Metric       | rsvhono | Next.js | TanStack Start |
| ------------ | ------- | ------- | -------------- |
| Requests/sec | 14,428  | 1,756   | 1,049          |
| p50          | 2.11ms  | 15ms    | 27ms           |
| p99          | 4.76ms  | 51ms    | 67ms           |
| Errors       | 0       | 0       | 0              |

### `/ssr`

| Metric       | rsvhono | Next.js | TanStack Start |
| ------------ | ------- | ------- | -------------- |
| Requests/sec | 285     | 125     | 161            |
| p50          | 107ms   | 256ms   | 192ms          |
| p99          | 215ms   | 338ms   | 386ms          |
| Errors       | 0       | 0       | 0              |

### `/interactive`

| Metric       | rsvhono | Next.js | TanStack Start |
| ------------ | ------- | ------- | -------------- |
| Requests/sec | 730     | 254     | 401            |
| p50          | 40ms    | 124ms   | 75ms           |
| p99          | 81ms    | 173ms   | 152ms          |
| Errors       | 0       | 0       | 0              |

### `/api/health`

| Metric       | rsvhono | Next.js | TanStack Start |
| ------------ | ------- | ------- | -------------- |
| Requests/sec | 13,457  | 1,139   | 5,073          |
| p50          | 2.28ms  | 25ms    | 4.58ms         |
| p99          | 4.95ms  | 63ms    | 21ms           |
| Errors       | 0       | 0       | 0              |

### Memory

Resident memory of the whole process tree, and of the single largest process in it — which is the server itself in all three. The tree total carries whatever `npm run start` left running and double-counts pages the processes share, so the **server** row is the one to compare.

**None of these are retained-memory figures.** RSS is a high-water mark that includes garbage V8 has not collected yet, and V8 sizes the old generation against the *allocation rate* — so under a fixed-duration load the fastest server churns the most and grows the largest heap. On this app a forced GC returned 362 MB of the 472 MB an uncapped `/api/health` run reported. All three are therefore given the same old-space budget (`--max-old-space-size=256`), which is what makes the rows comparable; the per-route sequence is there so a plateau is distinguishable from a climb. Retention per request measured on the rsvhono app, after a full GC, was under 20 B — a leak is not what these numbers show.

| Metric                  | rsvhono                                       | Next.js                                       | TanStack Start                                |
| ----------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| RSS idle — tree         | 137.26 MB (3 procs)                           | 143.41 MB (3 procs)                           | 234.84 MB (4 procs)                           |
| RSS idle — server       | 76.77 MB                                      | 83.09 MB                                      | 162.19 MB                                     |
| RSS after load — tree   | 215.32 MB (3 procs)                           | 250.16 MB (3 procs)                           | 280.93 MB (4 procs)                           |
| RSS after load — server | 158.32 MB                                     | 192.93 MB                                     | 211.30 MB                                     |
| RSS per route — server  | 100.43 MB → 153.77 MB → 158.22 MB → 158.32 MB | 141.53 MB → 189.09 MB → 191.73 MB → 192.93 MB | 199.43 MB → 209.55 MB → 211.25 MB → 211.30 MB |
| Requests served         | 231,342                                       | 26,297                                        | 53,668                                        |
| Churn per 1k requests   | 361.0 kB                                      | 4.18 MB                                       | 936.9 kB                                      |

## Server, by environment

The same three builds, given different amounts of machine. `load.mjs` above runs each with every core to itself; a deployed server usually has a slice of one. A pinned server is held to core 0 with `taskset` and the load driver kept off that core.

### all cores, 256 MB heap

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                          | TanStack Start                                   |
| -------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `/`            | 0.84 ms ± 0.11 ms (0.70 ms … 1.04 ms) · 10 × 128 | 1.50 ms ± 0.19 ms (1.26 ms … 1.81 ms) · 10 × 64  | 1.93 ms ± 0.22 ms (1.70 ms … 2.33 ms) · 10 × 64  |
| `/ssr`         | 4.66 ms ± 0.48 ms (3.77 ms … 5.23 ms) · 10 × 16  | 7.75 ms ± 0.75 ms (6.96 ms … 8.99 ms) · 10 × 16  | 7.43 ms ± 0.56 ms (6.69 ms … 8.71 ms) · 10 × 16  |
| `/interactive` | 2.41 ms ± 0.53 ms (1.89 ms … 3.68 ms) · 10 × 64  | 4.84 ms ± 0.58 ms (4.04 ms … 5.78 ms) · 10 × 32  | 3.93 ms ± 0.72 ms (3.39 ms … 5.65 ms) · 10 × 32  |
| `/api/health`  | 0.33 ms ± 0.09 ms (0.23 ms … 0.52 ms) · 10 × 256 | 1.39 ms ± 0.13 ms (1.24 ms … 1.61 ms) · 10 × 128 | 0.81 ms ± 0.13 ms (0.60 ms … 0.97 ms) · 10 × 128 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start |
| ------------------- | ------- | ------- | -------------- |
| first byte (median) | 3.16 ms | 5.71 ms | 6.12 ms        |
| last byte (median)  | 3.18 ms | 6.28 ms | 6.13 ms        |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 251 rps · 3.07 ms · 11.1 ms · 4.40 ms CPU | 144 rps · 5.90 ms · 18.2 ms · 8.25 ms CPU | 144 rps · 6.00 ms · 13.5 ms · 8.06 ms CPU |
| 8           | 279 rps · 24.4 ms · 65.1 ms · 4.16 ms CPU | 163 rps · 45.3 ms · 77.2 ms · 7.43 ms CPU | 158 rps · 44.2 ms · 110 ms · 7.34 ms CPU  |
| 32          | 290 rps · 107 ms · 210 ms · 3.97 ms CPU   | 142 rps · 226 ms · 274 ms · 9.29 ms CPU   | 158 rps · 191 ms · 383 ms · 7.38 ms CPU   |
| 128         | 239 rps · 476 ms · 5.10 s · 4.03 ms CPU   | 159 rps · 467 ms · 5.52 s · 7.90 ms CPU   | 167 rps · 299 ms · 5.71 s · 6.72 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 7,568 rps · 0.11 ms · 0.36 ms · 0.08 ms CPU  | 1,023 rps · 0.82 ms · 3.76 ms · 0.99 ms CPU | 3,748 rps · 0.19 ms · 0.89 ms · 0.25 ms CPU |
| 8           | 8,967 rps · 0.78 ms · 2.60 ms · 0.07 ms CPU  | 1,396 rps · 4.69 ms · 14.1 ms · 0.78 ms CPU | 4,690 rps · 1.13 ms · 7.48 ms · 0.24 ms CPU |
| 32          | 12,605 rps · 2.34 ms · 5.44 ms · 0.07 ms CPU | 1,296 rps · 22.0 ms · 51.0 ms · 0.82 ms CPU | 4,500 rps · 5.27 ms · 20.5 ms · 0.25 ms CPU |
| 128         | 12,859 rps · 9.89 ms · 16.6 ms · 0.07 ms CPU | 1,358 rps · 89.2 ms · 136 ms · 0.78 ms CPU  | 4,684 rps · 23.5 ms · 63.3 ms · 0.24 ms CPU |

|                                       | rsvhono   | Next.js   | TanStack Start |
| ------------------------------------- | --------- | --------- | -------------- |
| largest process, peak resident memory | 177.21 MB | 223.13 MB | 211.64 MB      |

### 1 core, 256 MB heap

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                         | TanStack Start                                   |
| -------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ |
| `/`            | 0.69 ms ± 0.17 ms (0.43 ms … 0.98 ms) · 10 × 128 | 1.55 ms ± 0.22 ms (1.22 ms … 2.01 ms) · 10 × 64 | 2.32 ms ± 0.46 ms (1.86 ms … 3.25 ms) · 10 × 64  |
| `/ssr`         | 5.33 ms ± 0.87 ms (4.31 ms … 7.37 ms) · 10 × 16  | 9.13 ms ± 1.21 ms (7.64 ms … 11.0 ms) · 10 × 16 | 8.71 ms ± 1.81 ms (7.04 ms … 12.0 ms) · 10 × 16  |
| `/interactive` | 2.40 ms ± 0.31 ms (2.08 ms … 2.94 ms) · 10 × 64  | 6.10 ms ± 1.42 ms (4.87 ms … 9.64 ms) · 10 × 16 | 4.48 ms ± 1.06 ms (3.19 ms … 6.95 ms) · 10 × 32  |
| `/api/health`  | 0.34 ms ± 0.13 ms (0.20 ms … 0.58 ms) · 10 × 256 | 1.68 ms ± 0.26 ms (1.40 ms … 2.21 ms) · 10 × 64 | 0.92 ms ± 0.18 ms (0.59 ms … 1.26 ms) · 10 × 128 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start |
| ------------------- | ------- | ------- | -------------- |
| first byte (median) | 2.99 ms | 6.05 ms | 8.61 ms        |
| last byte (median)  | 3.00 ms | 6.64 ms | 8.63 ms        |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 238 rps · 2.98 ms · 20.0 ms · 3.96 ms CPU | 121 rps · 6.15 ms · 35.0 ms · 7.92 ms CPU | 120 rps · 6.16 ms · 43.8 ms · 7.88 ms CPU |
| 8           | 247 rps · 25.6 ms · 84.8 ms · 4.00 ms CPU | 126 rps · 54.2 ms · 123 ms · 7.81 ms CPU  | 138 rps · 47.9 ms · 144 ms · 7.17 ms CPU  |
| 32          | 256 rps · 123 ms · 243 ms · 3.86 ms CPU   | 104 rps · 317 ms · 385 ms · 9.49 ms CPU   | 137 rps · 205 ms · 1.60 s · 7.15 ms CPU   |
| 128         | 261 rps · 219 ms · 5.52 s · 3.67 ms CPU   | 105 rps · 675 ms · 5.67 s · 9.07 ms CPU   | 142 rps · 686 ms · 5.84 s · 6.69 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 7,701 rps · 0.11 ms · 0.32 ms · 0.08 ms CPU  | 887 rps · 0.86 ms · 5.93 ms · 1.00 ms CPU   | 3,033 rps · 0.18 ms · 3.43 ms · 0.26 ms CPU |
| 8           | 12,930 rps · 0.51 ms · 1.52 ms · 0.07 ms CPU | 1,260 rps · 4.74 ms · 34.5 ms · 0.78 ms CPU | 4,329 rps · 1.01 ms · 14.0 ms · 0.22 ms CPU |
| 32          | 13,106 rps · 2.30 ms · 5.17 ms · 0.07 ms CPU | 1,296 rps · 21.4 ms · 70.1 ms · 0.77 ms CPU | 4,350 rps · 4.55 ms · 45.7 ms · 0.22 ms CPU |
| 128         | 13,119 rps · 9.62 ms · 18.7 ms · 0.07 ms CPU | 1,249 rps · 91.9 ms · 179 ms · 0.78 ms CPU  | 4,387 rps · 23.9 ms · 94.4 ms · 0.23 ms CPU |

|                                       | rsvhono   | Next.js   | TanStack Start |
| ------------------------------------- | --------- | --------- | -------------- |
| largest process, peak resident memory | 160.86 MB | 199.70 MB | 216.92 MB      |

### 1 core, 128 MB heap

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                          | TanStack Start                                   |
| -------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `/`            | 0.76 ms ± 0.21 ms (0.44 ms … 1.12 ms) · 10 × 128 | 1.45 ms ± 0.18 ms (1.19 ms … 1.86 ms) · 10 × 64  | 2.46 ms ± 0.36 ms (2.10 ms … 3.07 ms) · 10 × 64  |
| `/ssr`         | 5.12 ms ± 0.51 ms (4.12 ms … 5.78 ms) · 10 × 16  | 9.34 ms ± 1.22 ms (7.79 ms … 11.5 ms) · 10 × 16  | 9.21 ms ± 1.53 ms (7.42 ms … 11.8 ms) · 10 × 16  |
| `/interactive` | 2.52 ms ± 0.27 ms (2.20 ms … 3.04 ms) · 10 × 64  | 5.98 ms ± 1.13 ms (4.80 ms … 8.03 ms) · 10 × 16  | 4.10 ms ± 0.69 ms (3.21 ms … 5.39 ms) · 10 × 32  |
| `/api/health`  | 0.38 ms ± 0.07 ms (0.26 ms … 0.46 ms) · 10 × 256 | 1.59 ms ± 0.24 ms (1.26 ms … 2.05 ms) · 10 × 128 | 0.89 ms ± 0.16 ms (0.70 ms … 1.15 ms) · 10 × 128 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start |
| ------------------- | ------- | ------- | -------------- |
| first byte (median) | 3.02 ms | 7.02 ms | 8.18 ms        |
| last byte (median)  | 3.04 ms | 7.58 ms | 8.20 ms        |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 231 rps · 3.05 ms · 20.4 ms · 4.06 ms CPU | 120 rps · 6.18 ms · 34.8 ms · 8.02 ms CPU | 120 rps · 6.17 ms · 44.1 ms · 7.88 ms CPU |
| 8           | 245 rps · 25.9 ms · 86.7 ms · 4.05 ms CPU | 133 rps · 54.4 ms · 114 ms · 7.44 ms CPU  | 134 rps · 49.6 ms · 148 ms · 7.36 ms CPU  |
| 32          | 258 rps · 119 ms · 237 ms · 3.83 ms CPU   | 103 rps · 296 ms · 397 ms · 9.46 ms CPU   | 142 rps · 209 ms · 1.45 s · 6.93 ms CPU   |
| 128         | 255 rps · 223 ms · 5.49 s · 3.76 ms CPU   | 109 rps · 675 ms · 5.62 s · 8.74 ms CPU   | 147 rps · 334 ms · 5.83 s · 6.48 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 6,849 rps · 0.12 ms · 0.41 ms · 0.09 ms CPU  | 896 rps · 0.86 ms · 5.91 ms · 0.99 ms CPU   | 3,212 rps · 0.18 ms · 3.40 ms · 0.24 ms CPU |
| 8           | 12,826 rps · 0.51 ms · 1.74 ms · 0.07 ms CPU | 1,337 rps · 4.59 ms · 32.1 ms · 0.74 ms CPU | 4,312 rps · 1.04 ms · 14.9 ms · 0.22 ms CPU |
| 32          | 13,803 rps · 2.25 ms · 4.93 ms · 0.07 ms CPU | 1,308 rps · 21.5 ms · 69.8 ms · 0.75 ms CPU | 4,340 rps · 4.59 ms · 45.5 ms · 0.22 ms CPU |
| 128         | 13,394 rps · 9.45 ms · 15.8 ms · 0.07 ms CPU | 1,311 rps · 90.7 ms · 137 ms · 0.75 ms CPU  | 4,396 rps · 24.3 ms · 92.7 ms · 0.23 ms CPU |

|                                       | rsvhono   | Next.js   | TanStack Start |
| ------------------------------------- | --------- | --------- | -------------- |
| largest process, peak resident memory | 159.61 MB | 204.71 MB | 210.25 MB      |

### Node 24.22.3, all cores

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                          | TanStack Start                                   |
| -------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `/`            | 0.51 ms ± 0.13 ms (0.33 ms … 0.74 ms) · 10 × 128 | 1.49 ms ± 0.24 ms (1.14 ms … 1.92 ms) · 10 × 64  | 1.92 ms ± 0.50 ms (1.31 ms … 3.04 ms) · 10 × 64  |
| `/ssr`         | 4.55 ms ± 0.35 ms (3.94 ms … 5.10 ms) · 10 × 32  | 7.12 ms ± 0.77 ms (6.20 ms … 8.63 ms) · 10 × 16  | 8.57 ms ± 1.44 ms (6.87 ms … 10.3 ms) · 10 × 16  |
| `/interactive` | 1.92 ms ± 0.29 ms (1.61 ms … 2.47 ms) · 10 × 64  | 3.91 ms ± 0.41 ms (3.43 ms … 4.75 ms) · 10 × 32  | 3.73 ms ± 0.69 ms (3.09 ms … 5.33 ms) · 10 × 32  |
| `/api/health`  | 0.26 ms ± 0.05 ms (0.18 ms … 0.38 ms) · 10 × 512 | 1.13 ms ± 0.15 ms (0.92 ms … 1.33 ms) · 10 × 128 | 0.47 ms ± 0.13 ms (0.32 ms … 0.74 ms) · 10 × 256 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start |
| ------------------- | ------- | ------- | -------------- |
| first byte (median) | 3.20 ms | 4.81 ms | 6.49 ms        |
| last byte (median)  | 3.21 ms | 5.19 ms | 6.51 ms        |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 259 rps · 3.11 ms · 18.5 ms · 4.18 ms CPU | 172 rps · 5.11 ms · 14.3 ms · 6.91 ms CPU | 126 rps · 6.29 ms · 24.3 ms · 9.69 ms CPU |
| 8           | 271 rps · 23.5 ms · 80.1 ms · 4.33 ms CPU | 188 rps · 40.7 ms · 72.4 ms · 6.43 ms CPU | 134 rps · 53.7 ms · 137 ms · 9.10 ms CPU  |
| 32          | 284 rps · 106 ms · 220 ms · 4.02 ms CPU   | 193 rps · 157 ms · 213 ms · 6.24 ms CPU   | 138 rps · 216 ms · 445 ms · 8.40 ms CPU   |
| 128         | 270 rps · 212 ms · 5.45 s · 4.12 ms CPU   | 178 rps · 398 ms · 5.31 s · 6.46 ms CPU   | 136 rps · 367 ms · 5.91 s · 8.71 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 8,311 rps · 0.10 ms · 0.31 ms · 0.08 ms CPU  | 1,014 rps · 0.81 ms · 4.77 ms · 0.91 ms CPU | 4,036 rps · 0.17 ms · 0.57 ms · 0.23 ms CPU |
| 8           | 16,608 rps · 0.41 ms · 1.26 ms · 0.06 ms CPU | 1,381 rps · 4.86 ms · 17.5 ms · 0.79 ms CPU | 6,171 rps · 0.82 ms · 8.73 ms · 0.18 ms CPU |
| 32          | 17,767 rps · 1.82 ms · 3.81 ms · 0.05 ms CPU | 1,257 rps · 24.1 ms · 63.0 ms · 0.70 ms CPU | 5,955 rps · 3.73 ms · 18.7 ms · 0.19 ms CPU |
| 128         | 18,586 rps · 7.10 ms · 13.0 ms · 0.05 ms CPU | 1,528 rps · 80.4 ms · 125 ms · 0.69 ms CPU  | 5,934 rps · 15.9 ms · 57.2 ms · 0.19 ms CPU |

|                                       | rsvhono   | Next.js   | TanStack Start |
| ------------------------------------- | --------- | --------- | -------------- |
| largest process, peak resident memory | 311.35 MB | 343.45 MB | 411.07 MB      |

### Bun 1.4.4, all cores

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                          | TanStack Start                                   |
| -------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `/`            | 0.32 ms ± 0.09 ms (0.19 ms … 0.47 ms) · 10 × 256 | 1.18 ms ± 0.18 ms (0.97 ms … 1.53 ms) · 10 × 64  | 1.38 ms ± 0.26 ms (1.03 ms … 1.83 ms) · 10 × 64  |
| `/ssr`         | 3.35 ms ± 0.49 ms (2.74 ms … 4.10 ms) · 10 × 32  | 6.66 ms ± 1.11 ms (5.14 ms … 8.70 ms) · 10 × 16  | 6.39 ms ± 0.67 ms (5.40 ms … 7.22 ms) · 10 × 16  |
| `/interactive` | 1.31 ms ± 0.11 ms (1.08 ms … 1.44 ms) · 10 × 64  | 3.25 ms ± 0.34 ms (2.84 ms … 3.70 ms) · 10 × 32  | 2.91 ms ± 0.54 ms (2.42 ms … 4.06 ms) · 10 × 32  |
| `/api/health`  | 0.20 ms ± 0.03 ms (0.17 ms … 0.25 ms) · 10 × 512 | 1.15 ms ± 0.12 ms (0.91 ms … 1.33 ms) · 10 × 128 | 0.31 ms ± 0.03 ms (0.27 ms … 0.35 ms) · 10 × 512 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start |
| ------------------- | ------- | ------- | -------------- |
| first byte (median) | 2.53 ms | 5.54 ms | 4.89 ms        |
| last byte (median)  | 2.54 ms | 5.91 ms | 5.03 ms        |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 375 rps · 2.26 ms · 5.97 ms · 2.54 ms CPU | 207 rps · 4.17 ms · 10.9 ms · 5.42 ms CPU | 189 rps · 4.73 ms · 9.60 ms · 5.66 ms CPU |
| 8           | 410 rps · 16.1 ms · 42.7 ms · 2.57 ms CPU | 251 rps · 31.2 ms · 49.4 ms · 4.39 ms CPU | 211 rps · 34.0 ms · 75.5 ms · 5.04 ms CPU |
| 32          | 385 rps · 79.7 ms · 161 ms · 2.84 ms CPU  | 235 rps · 135 ms · 211 ms · 4.92 ms CPU   | 191 rps · 160 ms · 319 ms · 5.73 ms CPU   |
| 128         | 367 rps · 342 ms · 403 ms · 2.92 ms CPU   | 236 rps · 579 ms · 791 ms · 4.95 ms CPU   | 189 rps · 652 ms · 857 ms · 5.53 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                               |
| ----------- | -------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| 1           | 10,194 rps · 0.08 ms · 0.29 ms · 0.05 ms CPU | 1,531 rps · 0.57 ms · 2.56 ms · 0.59 ms CPU | 6,449 rps · 0.12 ms · 0.49 ms · 0.11 ms CPU  |
| 8           | 32,859 rps · 0.19 ms · 1.23 ms · 0.03 ms CPU | 2,230 rps · 2.82 ms · 10.3 ms · 0.47 ms CPU | 12,836 rps · 0.49 ms · 2.48 ms · 0.07 ms CPU |
| 32          | 32,075 rps · 0.79 ms · 3.17 ms · 0.03 ms CPU | 2,632 rps · 10.6 ms · 24.4 ms · 0.39 ms CPU | 13,854 rps · 2.09 ms · 5.31 ms · 0.07 ms CPU |
| 128         | 33,116 rps · 3.49 ms · 9.07 ms · 0.03 ms CPU | 2,760 rps · 44.1 ms · 81.8 ms · 0.38 ms CPU | 13,794 rps · 8.96 ms · 15.7 ms · 0.07 ms CPU |

|                                       | rsvhono   | Next.js   | TanStack Start |
| ------------------------------------- | --------- | --------- | -------------- |
| largest process, peak resident memory | 139.32 MB | 301.95 MB | 301.36 MB      |

## In the browser, by device

Chromium 153.0.8010.12, 7 isolated first visits per cell — nothing cached. Throttling is applied through the DevTools protocol, to the browser only; the server is the same unthrottled process in every profile. Bytes are gzip level 6, applied by the harness to every target: no app compresses, and none is left to its server's default.

Timings are `mean ± σ (min … max)`; sizes and counts are medians.

### desktop, unthrottled

**`/`**

|                                   | rsvhono                               | Next.js                               | TanStack Start                        |
| --------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                | 7.04 ms ± 4.94 ms (4.30 ms … 18.1 ms) | 11.6 ms ± 11.3 ms (4.40 ms … 33.7 ms) | 12.0 ms ± 12.7 ms (5.70 ms … 40.7 ms) |
| first contentful paint            | 72.0 ms ± 14.8 ms (52.0 ms … 100 ms)  | 73.7 ms ± 19.8 ms (52.0 ms … 112 ms)  | 72.6 ms ± 14.9 ms (60.0 ms … 104 ms)  |
| largest contentful paint          | 72.0 ms ± 14.8 ms (52.0 ms … 100 ms)  | 73.7 ms ± 19.8 ms (52.0 ms … 112 ms)  | 72.6 ms ± 14.9 ms (60.0 ms … 104 ms)  |
| total blocking time               | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time           | 17.3 ms ± 1.88 ms (14.2 ms … 19.4 ms) | 31.0 ms ± 8.03 ms (24.8 ms … 47.2 ms) | 35.9 ms ± 6.35 ms (27.1 ms … 47.7 ms) |
| soft navigation to `/ssr`         | 82.6 ms ± 21.5 ms (65.0 ms … 116 ms)  | 85.7 ms ± 14.5 ms (69.0 ms … 111 ms)  | 90.6 ms ± 17.5 ms (74.0 ms … 128 ms)  |
| bytes on the wire (gzip)          | 85.9 kB                               | 157.0 kB                              | 117.3 kB                              |
| of which JavaScript               | 82.7 kB                               | 149.1 kB                              | 113.4 kB                              |
| requests                          | 4                                     | 15                                    | 4                                     |
| JS heap after GC                  | 2.18 MB                               | 2.96 MB                               | 2.60 MB                               |
| soft navigation, bytes            | 4.3 kB                                | 0 B                                   | 29.5 kB                               |
| soft navigation, requests         | 1                                     | 0                                     | 2                                     |
| soft navigation kept the document | yes                                   | yes                                   | yes                                   |

**`/ssr`**

|                          | rsvhono                               | Next.js                               | TanStack Start                        |
| ------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte       | 19.5 ms ± 15.2 ms (10.3 ms … 53.1 ms) | 24.5 ms ± 14.6 ms (12.9 ms … 55.5 ms) | 17.0 ms ± 4.86 ms (11.4 ms … 25.7 ms) |
| first contentful paint   | 98.3 ms ± 19.0 ms (80.0 ms … 136 ms)  | 109 ms ± 10.7 ms (100 ms … 128 ms)    | 105 ms ± 19.1 ms (80.0 ms … 128 ms)   |
| largest contentful paint | 98.3 ms ± 19.0 ms (80.0 ms … 136 ms)  | 109 ms ± 10.7 ms (100 ms … 128 ms)    | 105 ms ± 19.1 ms (80.0 ms … 128 ms)   |
| total blocking time      | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time  | 23.8 ms ± 3.22 ms (18.5 ms … 28.3 ms) | 38.6 ms ± 3.47 ms (35.3 ms … 44.6 ms) | 43.2 ms ± 4.73 ms (36.4 ms … 47.9 ms) |
| bytes on the wire (gzip) | 90.8 kB                               | 162.2 kB                              | 165.6 kB                              |
| of which JavaScript      | 82.7 kB                               | 149.1 kB                              | 113.1 kB                              |
| requests                 | 4                                     | 15                                    | 4                                     |
| JS heap after GC         | 2.49 MB                               | 3.25 MB                               | 2.99 MB                               |

**`/interactive`**

|                                     | rsvhono                               | Next.js                               | TanStack Start                        |
| ----------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                  | 8.51 ms ± 1.76 ms (5.90 ms … 10.6 ms) | 10.5 ms ± 1.18 ms (8.70 ms … 12.3 ms) | 10.8 ms ± 2.82 ms (8.20 ms … 15.7 ms) |
| first contentful paint              | 82.9 ms ± 11.7 ms (68.0 ms … 104 ms)  | 87.4 ms ± 12.9 ms (76.0 ms … 112 ms)  | 81.7 ms ± 7.61 ms (72.0 ms … 96.0 ms) |
| largest contentful paint            | 82.9 ms ± 11.7 ms (68.0 ms … 104 ms)  | 87.4 ms ± 12.9 ms (76.0 ms … 112 ms)  | 81.7 ms ± 7.61 ms (72.0 ms … 96.0 ms) |
| total blocking time                 | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time             | 29.0 ms ± 5.94 ms (23.0 ms … 39.4 ms) | 34.3 ms ± 4.64 ms (30.3 ms … 44.5 ms) | 42.9 ms ± 2.86 ms (40.3 ms … 47.5 ms) |
| hydrated (counter answers a click)  | 131 ms ± 14.2 ms (116 ms … 151 ms)    | 153 ms ± 8.70 ms (147 ms … 172 ms)    | 147 ms ± 18.8 ms (134 ms … 189 ms)    |
| click → paint                       | 1.84 ms ± 0.39 ms (1.40 ms … 2.40 ms) | 1.90 ms ± 0.12 ms (1.80 ms … 2.10 ms) | 2.00 ms ± 0.32 ms (1.80 ms … 2.70 ms) |
| keystroke → paint (filter 100 rows) | 8.97 ms ± 5.32 ms (2.70 ms … 15.0 ms) | 8.49 ms ± 3.09 ms (2.90 ms … 11.5 ms) | 10.7 ms ± 5.63 ms (2.60 ms … 16.1 ms) |
| mutation round trip                 | 79.0 ms ± 8.02 ms (66.0 ms … 88.0 ms) | 69.9 ms ± 8.07 ms (56.0 ms … 79.0 ms) | 66.7 ms ± 7.09 ms (52.0 ms … 75.0 ms) |
| bytes on the wire (gzip)            | 89.6 kB                               | 162.1 kB                              | 136.8 kB                              |
| of which JavaScript                 | 84.0 kB                               | 150.5 kB                              | 115.6 kB                              |
| requests                            | 5                                     | 17                                    | 6                                     |
| JS heap after GC                    | 2.87 MB                               | 3.62 MB                               | 3.29 MB                               |
| mutation, bytes                     | 3.2 kB                                | 480 B                                 | 439 B                                 |

### mid-tier mobile (4× CPU, Slow 4G)

**`/`**

|                                   | rsvhono                               | Next.js                               | TanStack Start                        |
| --------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                | 6.20 ms ± 1.61 ms (4.10 ms … 8.80 ms) | 5.69 ms ± 1.21 ms (4.10 ms … 7.70 ms) | 7.11 ms ± 1.35 ms (5.40 ms … 9.70 ms) |
| first contentful paint            | 402 ms ± 11.3 ms (380 ms … 408 ms)    | 391 ms ± 10.8 ms (380 ms … 408 ms)    | 388 ms ± 11.3 ms (376 ms … 404 ms)    |
| largest contentful paint          | 402 ms ± 11.3 ms (380 ms … 408 ms)    | 391 ms ± 10.8 ms (380 ms … 408 ms)    | 388 ms ± 11.3 ms (376 ms … 404 ms)    |
| total blocking time               | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 83.4 ms ± 8.73 ms (74.0 ms … 95.0 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time           | 62.3 ms ± 3.92 ms (58.4 ms … 69.4 ms) | 122 ms ± 25.2 ms (99.9 ms … 171 ms)   | 138 ms ± 13.6 ms (119 ms … 155 ms)    |
| soft navigation to `/ssr`         | 373 ms ± 25.3 ms (332 ms … 395 ms)    | 355 ms ± 31.3 ms (333 ms … 423 ms)    | 486 ms ± 19.3 ms (469 ms … 526 ms)    |
| bytes on the wire (gzip)          | 85.9 kB                               | 158.7 kB                              | 117.3 kB                              |
| of which JavaScript               | 82.7 kB                               | 149.1 kB                              | 113.4 kB                              |
| requests                          | 4                                     | 17                                    | 4                                     |
| JS heap after GC                  | 2.18 MB                               | 2.97 MB                               | 2.61 MB                               |
| soft navigation, bytes            | 4.3 kB                                | 4.2 kB                                | 29.5 kB                               |
| soft navigation, requests         | 1                                     | 1                                     | 2                                     |
| soft navigation kept the document | yes                                   | yes                                   | yes                                   |

**`/ssr`**

|                          | rsvhono                               | Next.js                               | TanStack Start                        |
| ------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte       | 13.6 ms ± 3.44 ms (10.6 ms … 19.1 ms) | 17.7 ms ± 5.34 ms (12.0 ms … 26.4 ms) | 19.8 ms ± 5.39 ms (14.5 ms … 28.4 ms) |
| first contentful paint   | 444 ms ± 15.5 ms (424 ms … 472 ms)    | 454 ms ± 15.1 ms (432 ms … 480 ms)    | 437 ms ± 6.41 ms (428 ms … 448 ms)    |
| largest contentful paint | 444 ms ± 15.5 ms (424 ms … 472 ms)    | 454 ms ± 15.1 ms (432 ms … 480 ms)    | 437 ms ± 6.41 ms (428 ms … 448 ms)    |
| total blocking time      | 4.43 ms ± 11.7 ms (0.00 ms … 31.0 ms) | 78.1 ms ± 7.71 ms (70.0 ms … 91.0 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time  | 93.3 ms ± 22.6 ms (73.0 ms … 140 ms)  | 134 ms ± 19.7 ms (105 ms … 160 ms)    | 151 ms ± 13.9 ms (134 ms … 176 ms)    |
| bytes on the wire (gzip) | 90.8 kB                               | 163.6 kB                              | 165.6 kB                              |
| of which JavaScript      | 82.7 kB                               | 149.1 kB                              | 113.1 kB                              |
| requests                 | 4                                     | 17                                    | 4                                     |
| JS heap after GC         | 2.49 MB                               | 3.27 MB                               | 3.00 MB                               |

**`/interactive`**

|                                     | rsvhono                               | Next.js                               | TanStack Start                        |
| ----------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                  | 8.80 ms ± 1.88 ms (6.70 ms … 11.4 ms) | 12.9 ms ± 3.52 ms (9.60 ms … 19.9 ms) | 9.90 ms ± 1.45 ms (8.10 ms … 12.4 ms) |
| first contentful paint              | 415 ms ± 15.8 ms (392 ms … 436 ms)    | 405 ms ± 12.5 ms (388 ms … 428 ms)    | 406 ms ± 12.8 ms (388 ms … 420 ms)    |
| largest contentful paint            | 415 ms ± 15.8 ms (392 ms … 436 ms)    | 405 ms ± 12.5 ms (388 ms … 428 ms)    | 406 ms ± 12.8 ms (388 ms … 420 ms)    |
| total blocking time                 | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 98.0 ms ± 12.9 ms (76.0 ms … 112 ms)  | 12.0 ms ± 11.6 ms (0.00 ms … 33.0 ms) |
| main-thread script time             | 94.7 ms ± 16.0 ms (76.4 ms … 125 ms)  | 123 ms ± 8.28 ms (108 ms … 133 ms)    | 168 ms ± 17.0 ms (138 ms … 184 ms)    |
| hydrated (counter answers a click)  | 949 ms ± 25.7 ms (922 ms … 990 ms)    | 1.37 s ± 20.6 ms (1.34 s … 1.40 s)    | 1.21 s ± 12.6 ms (1.19 s … 1.23 s)    |
| click → paint                       | 6.90 ms ± 1.65 ms (4.00 ms … 9.10 ms) | 8.24 ms ± 0.65 ms (7.50 ms … 9.20 ms) | 8.17 ms ± 1.95 ms (6.60 ms … 12.0 ms) |
| keystroke → paint (filter 100 rows) | 15.3 ms ± 3.06 ms (11.0 ms … 19.7 ms) | 14.7 ms ± 3.00 ms (8.90 ms … 17.2 ms) | 16.3 ms ± 4.47 ms (11.2 ms … 22.9 ms) |
| mutation round trip                 | 301 ms ± 38.9 ms (271 ms … 382 ms)    | 291 ms ± 9.63 ms (277 ms … 306 ms)    | 295 ms ± 17.8 ms (277 ms … 323 ms)    |
| bytes on the wire (gzip)            | 89.6 kB                               | 162.6 kB                              | 136.8 kB                              |
| of which JavaScript                 | 84.0 kB                               | 150.5 kB                              | 115.6 kB                              |
| requests                            | 5                                     | 18                                    | 6                                     |
| JS heap after GC                    | 2.87 MB                               | 3.60 MB                               | 3.31 MB                               |
| mutation, bytes                     | 3.2 kB                                | 480 B                                 | 439 B                                 |

### low-end mobile (6× CPU, 3G)

**`/`**

|                                   | rsvhono                               | Next.js                               | TanStack Start                        |
| --------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                | 5.86 ms ± 1.68 ms (3.90 ms … 7.80 ms) | 6.96 ms ± 1.99 ms (4.30 ms … 10.3 ms) | 8.33 ms ± 3.02 ms (5.20 ms … 12.9 ms) |
| first contentful paint            | 727 ms ± 23.3 ms (704 ms … 752 ms)    | 735 ms ± 28.1 ms (708 ms … 792 ms)    | 734 ms ± 18.6 ms (716 ms … 764 ms)    |
| largest contentful paint          | 727 ms ± 23.3 ms (704 ms … 752 ms)    | 735 ms ± 28.1 ms (708 ms … 792 ms)    | 734 ms ± 18.6 ms (716 ms … 764 ms)    |
| total blocking time               | 7.43 ms ± 14.5 ms (0.00 ms … 40.0 ms) | 161 ms ± 24.7 ms (130 ms … 195 ms)    | 0.86 ms ± 1.86 ms (0.00 ms … 5.00 ms) |
| main-thread script time           | 102 ms ± 14.8 ms (74.2 ms … 119 ms)   | 175 ms ± 25.6 ms (131 ms … 199 ms)    | 207 ms ± 10.8 ms (193 ms … 223 ms)    |
| soft navigation to `/ssr`         | 922 ms ± 15.8 ms (905 ms … 952 ms)    | 943 ms ± 9.30 ms (931 ms … 957 ms)    | 969 ms ± 16.5 ms (949 ms … 997 ms)    |
| bytes on the wire (gzip)          | 85.9 kB                               | 158.7 kB                              | 117.3 kB                              |
| of which JavaScript               | 82.7 kB                               | 149.1 kB                              | 113.4 kB                              |
| requests                          | 4                                     | 17                                    | 4                                     |
| JS heap after GC                  | 2.18 MB                               | 2.97 MB                               | 2.61 MB                               |
| soft navigation, bytes            | 4.3 kB                                | 4.2 kB                                | 29.5 kB                               |
| soft navigation, requests         | 1                                     | 1                                     | 2                                     |
| soft navigation kept the document | yes                                   | yes                                   | yes                                   |

**`/ssr`**

|                          | rsvhono                               | Next.js                               | TanStack Start                        |
| ------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte       | 11.6 ms ± 2.12 ms (9.40 ms … 15.9 ms) | 20.1 ms ± 7.34 ms (14.3 ms … 33.2 ms) | 16.0 ms ± 2.86 ms (12.5 ms … 19.1 ms) |
| first contentful paint   | 811 ms ± 42.8 ms (772 ms … 892 ms)    | 798 ms ± 17.7 ms (776 ms … 832 ms)    | 811 ms ± 19.4 ms (780 ms … 836 ms)    |
| largest contentful paint | 811 ms ± 42.8 ms (772 ms … 892 ms)    | 798 ms ± 17.7 ms (776 ms … 832 ms)    | 811 ms ± 19.4 ms (780 ms … 836 ms)    |
| total blocking time      | 27.7 ms ± 14.8 ms (9.00 ms … 43.0 ms) | 152 ms ± 20.9 ms (125 ms … 190 ms)    | 29.0 ms ± 21.6 ms (0.00 ms … 63.0 ms) |
| main-thread script time  | 141 ms ± 18.8 ms (123 ms … 175 ms)    | 203 ms ± 29.1 ms (157 ms … 242 ms)    | 274 ms ± 32.2 ms (238 ms … 313 ms)    |
| bytes on the wire (gzip) | 90.8 kB                               | 157.6 kB                              | 165.6 kB                              |
| of which JavaScript      | 82.7 kB                               | 149.1 kB                              | 113.1 kB                              |
| requests                 | 4                                     | 10                                    | 4                                     |
| JS heap after GC         | 2.49 MB                               | 3.16 MB                               | 3.01 MB                               |

**`/interactive`**

|                                     | rsvhono                               | Next.js                               | TanStack Start                        |
| ----------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                  | 8.96 ms ± 3.62 ms (5.70 ms … 16.6 ms) | 13.4 ms ± 4.69 ms (8.20 ms … 22.6 ms) | 12.4 ms ± 2.81 ms (10.0 ms … 16.9 ms) |
| first contentful paint              | 746 ms ± 12.0 ms (728 ms … 760 ms)    | 742 ms ± 9.48 ms (732 ms … 752 ms)    | 757 ms ± 18.2 ms (740 ms … 788 ms)    |
| largest contentful paint            | 746 ms ± 12.0 ms (728 ms … 760 ms)    | 742 ms ± 9.48 ms (732 ms … 752 ms)    | 757 ms ± 18.2 ms (740 ms … 788 ms)    |
| total blocking time                 | 6.71 ms ± 6.37 ms (0.00 ms … 19.0 ms) | 225 ms ± 24.6 ms (194 ms … 268 ms)    | 59.1 ms ± 22.1 ms (39.0 ms … 102 ms)  |
| main-thread script time             | 159 ms ± 19.2 ms (137 ms … 182 ms)    | 199 ms ± 20.0 ms (160 ms … 217 ms)    | 254 ms ± 35.5 ms (217 ms … 324 ms)    |
| hydrated (counter answers a click)  | 1.93 s ± 25.4 ms (1.89 s … 1.96 s)    | 2.89 s ± 69.6 ms (2.78 s … 3.01 s)    | 2.42 s ± 49.1 ms (2.37 s … 2.52 s)    |
| click → paint                       | 12.3 ms ± 4.56 ms (8.80 ms … 22.4 ms) | 13.1 ms ± 2.49 ms (10.6 ms … 18.1 ms) | 12.6 ms ± 3.24 ms (10.2 ms … 18.0 ms) |
| keystroke → paint (filter 100 rows) | 22.5 ms ± 6.66 ms (16.0 ms … 36.7 ms) | 20.6 ms ± 4.31 ms (11.9 ms … 24.2 ms) | 23.6 ms ± 6.10 ms (18.1 ms … 36.8 ms) |
| mutation round trip                 | 951 ms ± 17.7 ms (923 ms … 979 ms)    | 886 ms ± 181 ms (477 ms … 979 ms)     | 960 ms ± 14.1 ms (944 ms … 982 ms)    |
| bytes on the wire (gzip)            | 89.6 kB                               | 162.6 kB                              | 136.8 kB                              |
| of which JavaScript                 | 84.0 kB                               | 150.5 kB                              | 115.6 kB                              |
| requests                            | 5                                     | 18                                    | 6                                     |
| JS heap after GC                    | 2.87 MB                               | 3.59 MB                               | 3.32 MB                               |
| mutation, bytes                     | 3.2 kB                                | 480 B                                 | 439 B                                 |

## Dev server startup

`dev` command to a served `/interactive` — which every one of these compiles lazily, so it includes compiling a route with three client components rather than just binding a socket. Cold clears the dev cache first.

HMR round-trip is the other number worth having here and is not measured: it needs a browser driving the page to assert the patch arrived.

| Metric         | rsvhono   | Next.js   | TanStack Start |
| -------------- | --------- | --------- | -------------- |
| Cold dev start | 2.21s ±9% | 3.74s ±1% | 4.69s ±3%      |
| Warm dev start | 2.22s ±4% | 3.65s ±2% | 4.33s ±1%      |

## Footprint

A production-only install (`--omit=dev`) into a throwaway directory, and the application code the spec took to express.

| Metric              | rsvhono  | Next.js   | TanStack Start |
| ------------------- | -------- | --------- | -------------- |
| Prod install size   | 76.44 MB | 298.74 MB | 61.81 MB       |
| Packages installed  | 96       | 22        | 97             |
| Direct dependencies | 4        | 3         | 4              |
| App source files    | 16       | 16        | 18             |
| App source lines    | 457      | 458       | 666            |
