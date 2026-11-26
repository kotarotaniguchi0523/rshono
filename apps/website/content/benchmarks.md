---
title: Benchmarks
description: One app built four ways — rsvhono, Next.js, TanStack Start and Waku — measured on payload bytes, build time, cold start and install size.
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

React version skew across the four is unavoidable — Next vendors its own copy — so it is reported rather than hidden. A render-path difference of a few percent is more likely this than the framework.

| Package                    | rsvhono     | Next.js | TanStack Start | Waku       |
| -------------------------- | ----------- | ------- | -------------- | ---------- |
| `react`                    | 19.3.1      | 19.2.8  | 19.2.8         | 19.3.1     |
| `react-dom`                | 19.3.1      | 19.2.8  | 19.2.8         | 19.3.1     |
| `@rsvhono/core`            | 1.0.0-rc.29 | —       | —              | —          |
| `hono`                     | 4.13.5      | —       | —              | 4.13.22    |
| `vite`                     | 8.3.8       | —       | 7.3.6          | 8.3.8      |
| `@vitejs/plugin-rsc`       | 0.5.39      | —       | —              | 0.5.39     |
| `react-server-dom-webpack` | 19.3.1      | —       | —              | 19.3.1     |
| `next`                     | —           | 16.2.12 | —              | —          |
| `@tanstack/react-start`    | —           | —       | 1.168.33       | —          |
| `@tanstack/react-router`   | —           | —       | 1.170.18       | —          |
| `waku`                     | —           | —       | —              | 1.0.0-rc.5 |

## At a glance

Every measurement below as a multiple of rsvhono's, which is **1×** by construction — it is the reference because this is its repository, not because it is the baseline anyone should hold. These were measured by the project that maintains one of the four; read them with that in mind, and re-run them.

Lower is better in every row. Where the samples support one, the ratio carries a 95% bootstrap interval: `1.25× [1.18, 1.31]` is a difference, `1.04× [0.96, 1.12]` is not, and is marked `≈`. The last row of each group is the geometric mean of the rows above it — the mean under which twice as slow in one place and twice as fast in another comes out even.

### Time

**Server, one request at a time — all cores, 256 MB heap**

|                    | rsvhono   | Next.js            | TanStack Start     | Waku               |
| ------------------ | --------- | ------------------ | ------------------ | ------------------ |
| `/`                | 1×        | 1.77× [1.59, 2.00] | 2.17× [2.04, 2.48] | 1.64× [1.32, 1.89] |
| `/ssr`             | 1×        | 1.83× [1.65, 2.11] | 1.67× [1.54, 1.81] | 1.61× [1.49, 1.75] |
| `/interactive`     | 1×        | 2.48× [2.08, 2.70] | 1.73× [1.53, 1.93] | 2.48× [2.11, 2.68] |
| `/api/health`      | 1×        | 5.19× [3.83, 6.34] | 2.78× [2.08, 3.25] | 4.83× [3.61, 5.44] |
| **geometric mean** | **1.00×** | **2.54×**          | **2.04×**          | **2.37×**          |

**Server, CPU per request at 128 connections — all cores, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 2.14×     | 1.87×          | 1.62×     |
| `/api/health`      | 1×        | 9.59×     | 3.41×          | 9.41×     |
| **geometric mean** | **1.00×** | **4.53×** | **2.53×**      | **3.91×** |

**Server, 99th-percentile latency at 128 connections — all cores, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 1.44×     | 1.55×          | 1.49×     |
| `/api/health`      | 1×        | 6.91×     | 3.72×          | 8.72×     |
| **geometric mean** | **1.00×** | **3.16×** | **2.40×**      | **3.60×** |

**Server, one request at a time — 1 core, 256 MB heap**

|                    | rsvhono   | Next.js            | TanStack Start     | Waku               |
| ------------------ | --------- | ------------------ | ------------------ | ------------------ |
| `/`                | 1×        | 1.78× [1.45, 2.79] | 2.81× [2.31, 5.07] | 2.02× [1.58, 3.14] |
| `/ssr`             | 1×        | 1.55× [1.39, 1.89] | 1.66× [1.42, 2.11] | 1.47× [1.32, 1.64] |
| `/interactive`     | 1×        | 2.02× [1.77, 2.44] | 1.82× [1.54, 2.35] | 2.01× [1.73, 2.41] |
| `/api/health`      | 1×        | 4.39× [3.56, 6.25] | 2.52× [1.79, 3.73] | 4.57× [3.74, 6.49] |
| **geometric mean** | **1.00×** | **2.23×**          | **2.15×**          | **2.29×**          |

**Server, CPU per request at 128 connections — 1 core, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 2.25×     | 1.77×          | 1.48×     |
| `/api/health`      | 1×        | 10.78×    | 3.38×          | 9.82×     |
| **geometric mean** | **1.00×** | **4.92×** | **2.45×**      | **3.81×** |

**Server, 99th-percentile latency at 128 connections — 1 core, 256 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 1.03×     | 1.07×          | 1.01×     |
| `/api/health`      | 1×        | 10.50×    | 6.08×          | 8.27×     |
| **geometric mean** | **1.00×** | **3.29×** | **2.56×**      | **2.89×** |

**Server, one request at a time — 1 core, 128 MB heap**

|                    | rsvhono   | Next.js            | TanStack Start     | Waku               |
| ------------------ | --------- | ------------------ | ------------------ | ------------------ |
| `/`                | 1×        | 1.97× [1.58, 2.65] | 2.43× [1.99, 3.31] | 1.79× [1.39, 2.41] |
| `/ssr`             | 1×        | 1.94× [1.62, 2.71] | 1.75× [1.44, 2.17] | 1.84× [1.58, 2.18] |
| `/interactive`     | 1×        | 2.53× [2.25, 2.93] | 1.68× [1.51, 2.19] | 2.22× [1.95, 2.84] |
| `/api/health`      | 1×        | 5.33× [4.12, 6.69] | 2.83× [2.14, 3.54] | 4.58× [3.52, 5.53] |
| **geometric mean** | **1.00×** | **2.68×**          | **2.12×**          | **2.41×**          |

**Server, CPU per request at 128 connections — 1 core, 128 MB heap**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 2.33×     | 2.11×          | 1.69×     |
| `/api/health`      | 1×        | 10.38×    | 3.89×          | 9.41×     |
| **geometric mean** | **1.00×** | **4.91×** | **2.87×**      | **3.99×** |

**Server, 99th-percentile latency at 128 connections — 1 core, 128 MB heap**

|                    | rsvhono   | Next.js    | TanStack Start | Waku      |
| ------------------ | --------- | ---------- | -------------- | --------- |
| `/ssr`             | 1×        | 1.05×      | 1.17×          | 0.99×     |
| `/api/health`      | 1×        | 126.62×    | 7.40×          | 7.90×     |
| **geometric mean** | **1.00×** | **11.52×** | **2.94×**      | **2.80×** |

**Server, one request at a time — Node 24.22.3, all cores**

|                    | rsvhono   | Next.js              | TanStack Start       | Waku               |
| ------------------ | --------- | -------------------- | -------------------- | ------------------ |
| `/`                | 1×        | 1.92× [1.40, 2.45]   | 2.34× [1.65, 3.09]   | 1.99× [1.50, 2.65] |
| `/ssr`             | 1×        | ≈ 1.10× [0.98, 1.44] | 1.27× [1.03, 1.80]   | 1.15× [1.00, 1.57] |
| `/interactive`     | 1×        | 1.54× [1.41, 1.89]   | 1.78× [1.28, 2.12]   | 1.93× [1.72, 2.04] |
| `/api/health`      | 1×        | 3.08× [2.28, 3.71]   | ≈ 1.52× [0.99, 1.90] | 2.98× [2.22, 3.52] |
| **geometric mean** | **1.00×** | **1.78×**            | **1.68×**            | **1.91×**          |

**Server, CPU per request at 128 connections — Node 24.22.3, all cores**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 1.65×     | 2.45×          | 1.43×     |
| `/api/health`      | 1×        | 13.67×    | 3.59×          | 14.33×    |
| **geometric mean** | **1.00×** | **4.74×** | **2.97×**      | **4.53×** |

**Server, 99th-percentile latency at 128 connections — Node 24.22.3, all cores**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 0.99×     | 1.10×          | 1.00×     |
| `/api/health`      | 1×        | 8.71×     | 4.28×          | 11.73×    |
| **geometric mean** | **1.00×** | **2.94×** | **2.17×**      | **3.43×** |

**Server, one request at a time — Bun 1.4.4, all cores**

|                    | rsvhono   | Next.js            | TanStack Start       | Waku               |
| ------------------ | --------- | ------------------ | -------------------- | ------------------ |
| `/`                | 1×        | 4.40× [3.07, 5.14] | 4.35× [3.02, 5.07]   | 1.97× [1.24, 2.60] |
| `/ssr`             | 1×        | 2.57× [2.22, 3.06] | 1.79× [1.54, 2.12]   | 1.50× [1.30, 1.87] |
| `/interactive`     | 1×        | 2.31× [2.06, 2.71] | 2.13× [1.79, 2.28]   | 2.48× [2.21, 2.70] |
| `/api/health`      | 1×        | 3.61× [3.01, 4.63] | ≈ 1.23× [0.90, 1.61] | 1.40× [1.04, 2.17] |
| **geometric mean** | **1.00×** | **3.11×**          | **2.12×**            | **1.79×**          |

**Server, CPU per request at 128 connections — Bun 1.4.4, all cores**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 1.66×     | 1.85×          | 1.12×     |
| `/api/health`      | 1×        | 11.99×    | 2.19×          | 3.33×     |
| **geometric mean** | **1.00×** | **4.46×** | **2.01×**      | **1.93×** |

**Server, 99th-percentile latency at 128 connections — Bun 1.4.4, all cores**

|                    | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------ | --------- | --------- | -------------- | --------- |
| `/ssr`             | 1×        | 1.69×     | 1.61×          | 1.61×     |
| `/api/health`      | 1×        | 9.11×     | 1.71×          | 2.65×     |
| **geometric mean** | **1.00×** | **3.92×** | **1.66×**      | **2.06×** |

**Browser — desktop, unthrottled**

|                                         | rsvhono   | Next.js              | TanStack Start       | Waku                 |
| --------------------------------------- | --------- | -------------------- | -------------------- | -------------------- |
| `/` first contentful paint              | 1×        | ≈ 1.33× [0.89, 1.88] | ≈ 1.06× [0.84, 1.12] | ≈ 1.22× [1.00, 1.35] |
| `/` largest contentful paint            | 1×        | ≈ 1.33× [0.89, 1.88] | ≈ 1.06× [0.84, 1.12] | ≈ 1.22× [1.00, 1.35] |
| `/` main-thread script time             | 1×        | 2.06× [1.60, 2.44]   | 2.42× [1.81, 2.68]   | ≈ 1.29× [0.93, 1.54] |
| `/` soft navigation to `/ssr`           | 1×        | 1.40× [1.03, 1.68]   | ≈ 1.14× [0.80, 1.34] | 0.93× [0.73, 0.99]   |
| `/ssr` first contentful paint           | 1×        | 1.31× [1.07, 1.40]   | ≈ 1.00× [0.93, 1.20] | 1.38× [1.26, 1.72]   |
| `/ssr` largest contentful paint         | 1×        | 1.31× [1.07, 1.40]   | ≈ 1.00× [0.93, 1.20] | 1.38× [1.26, 1.72]   |
| `/ssr` main-thread script time          | 1×        | 1.66× [1.25, 1.86]   | 1.81× [1.39, 2.09]   | ≈ 1.32× [0.89, 1.53] |
| `/interactive` first contentful paint   | 1×        | 1.60× [1.24, 1.90]   | ≈ 1.20× [1.00, 1.35] | 1.35× [1.13, 1.70]   |
| `/interactive` largest contentful paint | 1×        | 1.60× [1.24, 1.90]   | ≈ 1.20× [1.00, 1.35] | 1.35× [1.13, 1.70]   |
| `/interactive` main-thread script time  | 1×        | 1.37× [1.12, 1.78]   | 1.44× [1.28, 2.00]   | ≈ 0.94× [0.79, 1.55] |
| `/interactive` hydrated                 | 1×        | 1.51× [1.23, 1.86]   | 1.23× [1.07, 1.42]   | 1.27× [1.09, 1.46]   |
| `/interactive` click → paint            | 1×        | 1.41× [1.11, 1.75]   | 1.29× [1.05, 1.75]   | ≈ 1.24× [1.00, 1.94] |
| `/interactive` keystroke → paint        | 1×        | ≈ 1.84× [0.40, 4.27] | ≈ 0.92× [0.45, 3.20] | ≈ 1.90× [0.66, 4.63] |
| `/interactive` mutation round trip      | 1×        | 1.26× [1.07, 1.36]   | ≈ 1.09× [0.96, 1.30] | 1.29× [1.01, 1.40]   |
| **geometric mean**                      | **1.00×** | **1.48×**            | **1.23×**            | **1.27×**            |

**Browser — mid-tier mobile (4× CPU, Slow 4G)**

|                                         | rsvhono   | Next.js              | TanStack Start       | Waku                 |
| --------------------------------------- | --------- | -------------------- | -------------------- | -------------------- |
| `/` first contentful paint              | 1×        | 1.06× [1.02, 1.11]   | ≈ 1.00× [0.98, 1.03] | 1.07× [1.02, 1.14]   |
| `/` largest contentful paint            | 1×        | 1.06× [1.02, 1.11]   | ≈ 1.00× [0.98, 1.03] | 1.07× [1.02, 1.14]   |
| `/` main-thread script time             | 1×        | 2.20× [1.87, 2.77]   | 2.13× [1.97, 2.81]   | 1.55× [1.30, 2.06]   |
| `/` soft navigation to `/ssr`           | 1×        | ≈ 1.22× [1.00, 1.38] | 1.41× [1.22, 1.61]   | 2.47× [1.16, 2.84]   |
| `/ssr` first contentful paint           | 1×        | 1.14× [1.02, 1.18]   | ≈ 1.06× [0.97, 1.07] | ≈ 1.07× [1.00, 1.22] |
| `/ssr` largest contentful paint         | 1×        | 1.14× [1.02, 1.18]   | ≈ 1.06× [0.97, 1.07] | ≈ 1.07× [1.00, 1.22] |
| `/ssr` main-thread script time          | 1×        | 2.03× [1.91, 2.52]   | 1.96× [1.84, 2.36]   | 1.42× [1.27, 1.77]   |
| `/interactive` first contentful paint   | 1×        | ≈ 1.02× [0.96, 1.10] | ≈ 1.03× [0.96, 1.10] | ≈ 1.07× [0.98, 1.13] |
| `/interactive` largest contentful paint | 1×        | ≈ 1.02× [0.96, 1.10] | ≈ 1.03× [0.96, 1.10] | ≈ 1.07× [0.98, 1.13] |
| `/interactive` main-thread script time  | 1×        | 1.67× [1.45, 1.94]   | 1.73× [1.51, 2.24]   | 1.52× [1.22, 2.26]   |
| `/interactive` hydrated                 | 1×        | 1.53× [1.48, 1.57]   | 1.27× [1.22, 1.33]   | ≈ 1.03× [0.98, 1.13] |
| `/interactive` click → paint            | 1×        | ≈ 1.18× [0.86, 1.40] | 1.44× [1.02, 1.72]   | ≈ 1.16× [0.87, 1.45] |
| `/interactive` keystroke → paint        | 1×        | ≈ 0.86× [0.64, 1.34] | 1.20× [1.08, 1.72]   | 1.37× [1.08, 1.85]   |
| `/interactive` mutation round trip      | 1×        | ≈ 1.08× [0.98, 1.17] | ≈ 1.12× [1.00, 1.22] | ≈ 1.13× [0.96, 1.18] |
| **geometric mean**                      | **1.00×** | **1.25×**            | **1.27×**            | **1.25×**            |

**Browser — low-end mobile (6× CPU, 3G)**

|                                         | rsvhono   | Next.js              | TanStack Start       | Waku                 |
| --------------------------------------- | --------- | -------------------- | -------------------- | -------------------- |
| `/` first contentful paint              | 1×        | ≈ 1.03× [0.99, 1.07] | ≈ 1.00× [0.99, 1.02] | ≈ 1.06× [0.97, 1.09] |
| `/` largest contentful paint            | 1×        | ≈ 1.03× [0.99, 1.07] | ≈ 1.00× [0.99, 1.02] | ≈ 1.06× [0.97, 1.09] |
| `/` main-thread script time             | 1×        | 1.78× [1.20, 2.56]   | 1.87× [1.30, 2.73]   | ≈ 1.36× [0.95, 2.37] |
| `/` soft navigation to `/ssr`           | 1×        | ≈ 1.02× [0.98, 1.21] | ≈ 1.03× [0.98, 1.08] | ≈ 1.01× [0.96, 1.05] |
| `/ssr` first contentful paint           | 1×        | 1.17× [1.07, 1.20]   | ≈ 1.06× [1.00, 1.08] | 1.06× [1.01, 1.10]   |
| `/ssr` largest contentful paint         | 1×        | 1.17× [1.07, 1.20]   | ≈ 1.06× [1.00, 1.08] | 1.06× [1.01, 1.10]   |
| `/ssr` main-thread script time          | 1×        | 2.66× [2.20, 3.17]   | 2.19× [1.70, 2.50]   | 1.43× [1.27, 1.91]   |
| `/interactive` first contentful paint   | 1×        | ≈ 0.99× [0.94, 1.10] | ≈ 1.01× [0.95, 1.06] | ≈ 0.99× [0.95, 1.05] |
| `/interactive` largest contentful paint | 1×        | ≈ 0.99× [0.94, 1.10] | ≈ 1.01× [0.95, 1.06] | ≈ 0.99× [0.95, 1.05] |
| `/interactive` main-thread script time  | 1×        | 1.34× [1.13, 1.75]   | 1.76× [1.52, 1.96]   | 1.45× [1.16, 1.71]   |
| `/interactive` hydrated                 | 1×        | 1.51× [1.46, 1.59]   | 1.28× [1.25, 1.31]   | ≈ 1.01× [1.00, 1.04] |
| `/interactive` click → paint            | 1×        | ≈ 1.17× [0.82, 2.57] | ≈ 1.35× [0.92, 1.44] | ≈ 1.27× [0.95, 2.58] |
| `/interactive` keystroke → paint        | 1×        | ≈ 0.94× [0.63, 1.93] | ≈ 1.24× [0.93, 1.78] | ≈ 1.06× [0.85, 2.18] |
| `/interactive` mutation round trip      | 1×        | ≈ 1.03× [0.67, 1.07] | ≈ 1.02× [0.99, 1.06] | ≈ 0.98× [0.53, 1.03] |
| **geometric mean**                      | **1.00×** | **1.22×**            | **1.23×**            | **1.12×**            |

| All 82 rows    | rsvhono   | Next.js   | TanStack Start | Waku      |
| -------------- | --------- | --------- | -------------- | --------- |
| geometric mean | **1.00×** | **2.06×** | **1.65×**      | **1.76×** |

### Size — a separate question, and never averaged with time

**Browser — desktop, unthrottled**

|                                         | rsvhono   | Next.js   | TanStack Start | Waku      |
| --------------------------------------- | --------- | --------- | -------------- | --------- |
| `/` bytes on the wire (gzip)            | 1×        | 1.84×     | 1.37×          | 1.07×     |
| `/` of which JavaScript                 | 1×        | 1.80×     | 1.37×          | 1.07×     |
| `/` JS heap after GC                    | 1×        | 1.36×     | 1.19×          | 1.04×     |
| `/` soft navigation, bytes              | 1×        | 1.00×     | 6.93×          | 6.73×     |
| `/ssr` bytes on the wire (gzip)         | 1×        | 1.79×     | 1.82×          | 1.06×     |
| `/ssr` of which JavaScript              | 1×        | 1.80×     | 1.37×          | 1.07×     |
| `/ssr` JS heap after GC                 | 1×        | 1.31×     | 1.20×          | 1.04×     |
| `/interactive` bytes on the wire (gzip) | 1×        | 1.81×     | 1.53×          | 1.06×     |
| `/interactive` of which JavaScript      | 1×        | 1.79×     | 1.38×          | 1.06×     |
| `/interactive` JS heap after GC         | 1×        | 1.26×     | 1.15×          | 1.04×     |
| `/interactive` mutation, bytes          | 1×        | 0.15×     | 0.14×          | 0.08×     |
| **geometric mean**                      | **1.00×** | **1.25×** | **1.28×**      | **0.99×** |

**Browser — mid-tier mobile (4× CPU, Slow 4G)**

|                                         | rsvhono   | Next.js   | TanStack Start | Waku      |
| --------------------------------------- | --------- | --------- | -------------- | --------- |
| `/` bytes on the wire (gzip)            | 1×        | 1.85×     | 1.37×          | 1.07×     |
| `/` of which JavaScript                 | 1×        | 1.80×     | 1.37×          | 1.07×     |
| `/` JS heap after GC                    | 1×        | 1.36×     | 1.20×          | 1.04×     |
| `/` soft navigation, bytes              | 1×        | 1.00×     | 6.93×          | —         |
| `/ssr` bytes on the wire (gzip)         | 1×        | 1.80×     | 1.82×          | 1.06×     |
| `/ssr` of which JavaScript              | 1×        | 1.80×     | 1.37×          | 1.07×     |
| `/ssr` JS heap after GC                 | 1×        | 1.32×     | 1.21×          | 1.04×     |
| `/interactive` bytes on the wire (gzip) | 1×        | 1.81×     | 1.53×          | 1.06×     |
| `/interactive` of which JavaScript      | 1×        | 1.79×     | 1.38×          | 1.06×     |
| `/interactive` JS heap after GC         | 1×        | 1.26×     | 1.16×          | 1.03×     |
| `/interactive` mutation, bytes          | 1×        | 0.15×     | 0.14×          | 0.08×     |
| **geometric mean**                      | **1.00×** | **1.28×** | **1.08×**      | **0.82×** |

**Browser — low-end mobile (6× CPU, 3G)**

|                                         | rsvhono   | Next.js   | TanStack Start | Waku      |
| --------------------------------------- | --------- | --------- | -------------- | --------- |
| `/` bytes on the wire (gzip)            | 1×        | 1.78×     | 1.37×          | 1.07×     |
| `/` of which JavaScript                 | 1×        | 1.80×     | 1.37×          | 1.07×     |
| `/` JS heap after GC                    | 1×        | 1.31×     | 1.20×          | 1.04×     |
| `/` soft navigation, bytes              | 1×        | 2.38×     | 6.93×          | —         |
| `/ssr` bytes on the wire (gzip)         | 1×        | 1.74×     | 1.82×          | 1.06×     |
| `/ssr` of which JavaScript              | 1×        | 1.80×     | 1.37×          | 1.07×     |
| `/ssr` JS heap after GC                 | 1×        | 1.27×     | 1.21×          | 1.04×     |
| `/interactive` bytes on the wire (gzip) | 1×        | 1.77×     | 1.53×          | 1.06×     |
| `/interactive` of which JavaScript      | 1×        | 1.79×     | 1.38×          | 1.06×     |
| `/interactive` JS heap after GC         | 1×        | 1.25×     | 1.16×          | 1.03×     |
| `/interactive` mutation, bytes          | 1×        | 1.41×     | 0.14×          | 0.08×     |
| **geometric mean**                      | **1.00×** | **1.57×** | **1.08×**      | **0.82×** |

| All 33 rows    | rsvhono   | Next.js   | TanStack Start | Waku      |
| -------------- | --------- | --------- | -------------- | --------- |
| geometric mean | **1.00×** | **1.36×** | **1.15×**      | **0.88×** |

## Initial-load payload

Brotli-compressed bytes the browser is committed to fetching before the route is interactive: the document, the inline flight payload, and every statically referenced script and stylesheet. Compression is applied by the harness, identically for all four.

### `/` — prerendered

| Metric              | rsvhono           | Next.js            | TanStack Start    | Waku              |
| ------------------- | ----------------- | ------------------ | ----------------- | ----------------- |
| Document (br)       | 1.2 kB            | 1.7 kB             | 1.1 kB            | 1.7 kB            |
| Inline script (raw) | 3.4 kB            | 5.7 kB             | 1.3 kB            | 4.4 kB            |
| External JS (br)    | 70.1 kB · 2 files | 160.0 kB · 9 files | 97.2 kB · 2 files | 75.6 kB · 4 files |
| CSS (br)            | 615 B · 1         | 615 B · 1          | 611 B · 1         | 615 B · 1         |
| **Total (br)**      | **71.9 kB**       | **162.3 kB**       | **98.9 kB**       | **77.9 kB**       |
| Total (raw)         | 267.1 kB          | 627.8 kB           | 356.5 kB          | 281.4 kB          |
| Requests            | 4                 | 11                 | 4                 | 6                 |
| Spec checks         | ✓                 | ✓                  | ✓                 | ✓                 |

### `/ssr` — dynamic

| Metric              | rsvhono           | Next.js            | TanStack Start    | Waku              |
| ------------------- | ----------------- | ------------------ | ----------------- | ----------------- |
| Document (br)       | 4.7 kB            | 5.2 kB             | 5.3 kB            | 5.1 kB            |
| Inline script (raw) | 36.3 kB           | 38.9 kB            | 37.4 kB           | 37.0 kB           |
| External JS (br)    | 70.1 kB · 2 files | 160.0 kB · 9 files | 97.0 kB · 2 files | 75.6 kB · 4 files |
| CSS (br)            | 615 B · 1         | 615 B · 1          | 611 B · 1         | 615 B · 1         |
| **Total (br)**      | **75.4 kB**       | **165.8 kB**       | **102.9 kB**      | **81.3 kB**       |
| Total (raw)         | 312.4 kB          | 673.4 kB           | 404.3 kB          | 326.4 kB          |
| Requests            | 4                 | 11                 | 4                 | 6                 |
| Spec checks         | ✓                 | ✓                  | ✓                 | ✓                 |

### `/interactive` — dynamic

| Metric              | rsvhono           | Next.js             | TanStack Start    | Waku              |
| ------------------- | ----------------- | ------------------- | ----------------- | ----------------- |
| Document (br)       | 3.2 kB            | 3.7 kB              | 3.8 kB            | 3.7 kB            |
| Inline script (raw) | 14.5 kB           | 17.6 kB             | 15.7 kB           | 15.5 kB           |
| External JS (br)    | 70.8 kB · 3 files | 160.9 kB · 10 files | 98.5 kB · 4 files | 76.3 kB · 5 files |
| CSS (br)            | 615 B · 1         | 615 B · 1           | 611 B · 1         | 615 B · 1         |
| **Total (br)**      | **74.6 kB**       | **165.2 kB**        | **102.9 kB**      | **80.5 kB**       |
| Total (raw)         | 282.7 kB          | 644.7 kB            | 376.6 kB          | 297.0 kB          |
| Requests            | 5                 | 12                  | 6                 | 7                 |
| Spec checks         | ✓                 | ✓                   | ✓                 | ✓                 |

### `/api/health` — json

| Metric              | rsvhono       | Next.js       | TanStack Start | Waku          |
| ------------------- | ------------- | ------------- | -------------- | ------------- |
| Document (br)       | 32 B          | 32 B          | 32 B           | 32 B          |
| Inline script (raw) | 0 B           | 0 B           | 0 B            | 0 B           |
| External JS (br)    | 0 B · 0 files | 0 B · 0 files | 0 B · 0 files  | 0 B · 0 files |
| CSS (br)            | 0 B · 0       | 0 B · 0       | 0 B · 0        | 0 B · 0       |
| **Total (br)**      | **32 B**      | **32 B**      | **32 B**       | **32 B**      |
| Total (raw)         | 28 B          | 28 B          | 28 B           | 28 B          |
| Requests            | 1             | 1             | 1              | 1             |
| Spec checks         | ✓             | ✓             | ✓              | ✓             |

## Build

Median of 3 trials. Cold clears the framework's cache directory first; warm keeps it and touches one source file the interactive route imports.

| Metric        | rsvhono    | Next.js   | TanStack Start | Waku      |
| ------------- | ---------- | --------- | -------------- | --------- |
| Cold build    | 1.39s ±21% | 8.20s ±0% | 7.37s ±5%      | 1.70s ±7% |
| Warm rebuild  | 1.41s ±3%  | 8.24s ±1% | 7.52s ±1%      | 1.71s ±3% |
| Build output  | 1.98 MB    | 5.92 MB   | 1.57 MB        | 1.28 MB   |
| Output files  | 35         | 198       | 30             | 30        |
| Server bundle | 95.1 kB    | —         | 804.3 kB       | 121.2 kB  |

## Cold start

Process spawn to first answered request, fresh process each trial. Not a real serverless cold start — no container, no network — it isolates the JavaScript the framework has to parse and run before it can respond.

| Metric                 | rsvhono    | Next.js   | TanStack Start | Waku       |
| ---------------------- | ---------- | --------- | -------------- | ---------- |
| Spawn → first response | 323ms ±11% | 496ms ±3% | 799ms ±3%      | 380ms ±10% |
| Server bundle          | 95.1 kB    | —         | 804.3 kB       | 121.2 kB   |

## Throughput

32 connections, 8s per route after a 2s warmup, driven by the harness's own Node load generator.

**Read this as a floor check, not a headline.** All four render through the same React and stream through the same react-dom, so a large gap would mean an HTTP layer is pathological rather than that one framework renders faster. The in-process driver is identically handicapping for all four, and its absolute rps is a lower bound. `/api/health` is the informative row: no React on the path, so it is router and response construction alone.

All four put React server components on the request path for `/ssr` and `/interactive` (APP_SPEC.md rule 8), so those two rows compare implementations of one architecture. They are not a perfect match: rsvhono and Next encode and decode the whole document, TanStack Start only the route body its RSC helpers wrap — its shell and nav stay on the cheaper non-RSC path. The flight round trip dominates both rows; on `/ssr` it is roughly 85% of the request.

### `/`

| Metric       | rsvhono | Next.js | TanStack Start | Waku  |
| ------------ | ------- | ------- | -------------- | ----- |
| Requests/sec | 13,191  | 1,853   | 1,017          | 1,394 |
| p50          | 2.20ms  | 15ms    | 28ms           | 21ms  |
| p99          | 6.52ms  | 46ms    | 69ms           | 51ms  |
| Errors       | 0       | 0       | 0              | 0     |

### `/ssr`

| Metric       | rsvhono | Next.js | TanStack Start | Waku  |
| ------------ | ------- | ------- | -------------- | ----- |
| Requests/sec | 267     | 119     | 149            | 174   |
| p50          | 112ms   | 266ms   | 208ms          | 172ms |
| p99          | 293ms   | 337ms   | 395ms          | 366ms |
| Errors       | 0       | 0       | 0              | 0     |

### `/interactive`

| Metric       | rsvhono | Next.js | TanStack Start | Waku  |
| ------------ | ------- | ------- | -------------- | ----- |
| Requests/sec | 740     | 226     | 402            | 352   |
| p50          | 39ms    | 141ms   | 74ms           | 84ms  |
| p99          | 78ms    | 214ms   | 149ms          | 184ms |
| Errors       | 0       | 0       | 0              | 0     |

### `/api/health`

| Metric       | rsvhono | Next.js | TanStack Start | Waku  |
| ------------ | ------- | ------- | -------------- | ----- |
| Requests/sec | 13,289  | 1,107   | 4,623          | 1,528 |
| p50          | 2.31ms  | 27ms    | 5.07ms         | 19ms  |
| p99          | 4.82ms  | 67ms    | 24ms           | 42ms  |
| Errors       | 0       | 0       | 0              | 0     |

### Memory

Resident memory of the whole process tree, and of the single largest process in it — which is the server itself in all four. The tree total carries whatever `npm run start` left running and double-counts pages the processes share, so the **server** row is the one to compare.

**None of these are retained-memory figures.** RSS is a high-water mark that includes garbage V8 has not collected yet, and V8 sizes the old generation against the *allocation rate* — so under a fixed-duration load the fastest server churns the most and grows the largest heap. On this app a forced GC returned 362 MB of the 472 MB an uncapped `/api/health` run reported. All four are therefore given the same old-space budget (`--max-old-space-size=256`), which is what makes the rows comparable; the per-route sequence is there so a plateau is distinguishable from a climb. Retention per request measured on the rsvhono app, after a full GC, was under 20 B — a leak is not what these numbers show.

| Metric                  | rsvhono                                      | Next.js                                       | TanStack Start                                | Waku                                          |
| ----------------------- | -------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| RSS idle — tree         | 136.86 MB (3 procs)                          | 143.96 MB (3 procs)                           | 235.39 MB (4 procs)                           | 144.89 MB (3 procs)                           |
| RSS idle — server       | 77.02 MB                                     | 83.40 MB                                      | 162.55 MB                                     | 84.34 MB                                      |
| RSS after load — tree   | 216.61 MB (3 procs)                          | 250.18 MB (3 procs)                           | 277.38 MB (4 procs)                           | 242.10 MB (3 procs)                           |
| RSS after load — server | 160.07 MB                                    | 192.84 MB                                     | 207.72 MB                                     | 185.07 MB                                     |
| RSS per route — server  | 99.74 MB → 156.97 MB → 159.99 MB → 160.07 MB | 143.30 MB → 187.70 MB → 191.69 MB → 192.84 MB | 196.96 MB → 205.87 MB → 207.68 MB → 207.72 MB | 140.50 MB → 179.96 MB → 184.03 MB → 185.07 MB |
| Requests served         | 220,015                                      | 26,511                                        | 49,628                                        | 27,658                                        |
| Churn per 1k requests   | 386.6 kB                                     | 4.13 MB                                       | 931.9 kB                                      | 3.64 MB                                       |

## Server, by environment

The same four builds, given different amounts of machine. `load.mjs` above runs each with every core to itself; a deployed server usually has a slice of one. A pinned server is held to core 0 with `taskset` and the load driver kept off that core.

### all cores, 256 MB heap

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                         | TanStack Start                                   | Waku                                             |
| -------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `/`            | 0.92 ms ± 0.06 ms (0.79 ms … 1.01 ms) · 10 × 128 | 1.63 ms ± 0.18 ms (1.35 ms … 1.87 ms) · 10 × 64 | 2.09 ms ± 0.23 ms (1.85 ms … 2.55 ms) · 10 × 64  | 1.53 ms ± 0.35 ms (1.18 ms … 2.31 ms) · 10 × 64  |
| `/ssr`         | 4.55 ms ± 0.36 ms (4.01 ms … 5.17 ms) · 10 × 32  | 8.56 ms ± 0.92 ms (7.56 ms … 10.1 ms) · 10 × 16 | 7.73 ms ± 0.94 ms (6.56 ms … 9.99 ms) · 10 × 16  | 7.24 ms ± 0.57 ms (5.89 ms … 7.99 ms) · 10 × 16  |
| `/interactive` | 2.14 ms ± 0.21 ms (1.86 ms … 2.45 ms) · 10 × 64  | 5.10 ms ± 0.61 ms (4.31 ms … 6.19 ms) · 10 × 32 | 3.73 ms ± 0.48 ms (3.14 ms … 4.64 ms) · 10 × 32  | 5.07 ms ± 0.41 ms (4.50 ms … 5.54 ms) · 10 × 32  |
| `/api/health`  | 0.32 ms ± 0.06 ms (0.25 ms … 0.41 ms) · 10 × 256 | 1.61 ms ± 0.27 ms (1.34 ms … 2.09 ms) · 10 × 64 | 0.88 ms ± 0.09 ms (0.79 ms … 1.07 ms) · 10 × 128 | 1.47 ms ± 0.17 ms (1.12 ms … 1.74 ms) · 10 × 128 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start | Waku    |
| ------------------- | ------- | ------- | -------------- | ------- |
| first byte (median) | 3.29 ms | 5.79 ms | 7.84 ms        | 6.29 ms |
| last byte (median)  | 3.30 ms | 6.32 ms | 7.86 ms        | 6.31 ms |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            | Waku                                      |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 265 rps · 2.99 ms · 10.4 ms · 4.23 ms CPU | 139 rps · 5.99 ms · 17.4 ms · 8.68 ms CPU | 139 rps · 6.09 ms · 17.3 ms · 8.50 ms CPU | 153 rps · 5.94 ms · 10.5 ms · 5.86 ms CPU |
| 8           | 277 rps · 24.8 ms · 66.6 ms · 4.22 ms CPU | 151 rps · 49.0 ms · 88.9 ms · 8.27 ms CPU | 146 rps · 48.3 ms · 120 ms · 7.93 ms CPU  | 201 rps · 33.0 ms · 93.9 ms · 5.53 ms CPU |
| 32          | 286 rps · 104 ms · 220 ms · 4.01 ms CPU   | 131 rps · 243 ms · 326 ms · 10.26 ms CPU  | 146 rps · 193 ms · 2.12 s · 7.78 ms CPU   | 167 rps · 176 ms · 399 ms · 6.96 ms CPU   |
| 128         | 281 rps · 402 ms · 3.77 s · 4.07 ms CPU   | 149 rps · 490 ms · 5.45 s · 8.71 ms CPU   | 145 rps · 333 ms · 5.86 s · 7.62 ms CPU   | 171 rps · 320 ms · 5.61 s · 6.61 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              | Waku                                        |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 7,511 rps · 0.11 ms · 0.36 ms · 0.09 ms CPU  | 1,045 rps · 0.82 ms · 3.30 ms · 0.96 ms CPU | 3,228 rps · 0.20 ms · 2.36 ms · 0.28 ms CPU | 998 rps · 0.90 ms · 2.51 ms · 0.82 ms CPU   |
| 8           | 12,380 rps · 0.52 ms · 1.64 ms · 0.08 ms CPU | 1,309 rps · 5.10 ms · 15.2 ms · 0.83 ms CPU | 4,227 rps · 1.37 ms · 8.01 ms · 0.27 ms CPU | 1,291 rps · 5.18 ms · 16.4 ms · 0.78 ms CPU |
| 32          | 13,087 rps · 2.30 ms · 5.78 ms · 0.07 ms CPU | 1,436 rps · 20.6 ms · 45.4 ms · 0.75 ms CPU | 4,224 rps · 6.41 ms · 20.9 ms · 0.26 ms CPU | 1,405 rps · 21.3 ms · 44.6 ms · 0.73 ms CPU |
| 128         | 12,304 rps · 9.94 ms · 18.3 ms · 0.08 ms CPU | 1,441 rps · 84.6 ms · 126 ms · 0.74 ms CPU  | 4,228 rps · 25.8 ms · 67.9 ms · 0.26 ms CPU | 1,384 rps · 86.7 ms · 159 ms · 0.73 ms CPU  |

|                                       | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------------------------- | --------- | --------- | -------------- | --------- |
| largest process, peak resident memory | 180.88 MB | 222.77 MB | 216.52 MB      | 185.83 MB |

### 1 core, 256 MB heap

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                         | TanStack Start                                   | Waku                                            |
| -------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `/`            | 0.81 ms ± 0.28 ms (0.39 ms … 1.15 ms) · 10 × 128 | 1.60 ms ± 0.21 ms (1.34 ms … 2.08 ms) · 10 × 64 | 2.83 ms ± 0.72 ms (2.18 ms … 4.48 ms) · 10 × 32  | 1.75 ms ± 0.23 ms (1.39 ms … 2.09 ms) · 10 × 64 |
| `/ssr`         | 5.61 ms ± 0.82 ms (4.28 ms … 7.11 ms) · 10 × 16  | 9.37 ms ± 1.65 ms (7.94 ms … 12.6 ms) · 10 × 16 | 9.91 ms ± 1.90 ms (8.02 ms … 13.2 ms) · 10 × 16  | 8.26 ms ± 0.59 ms (7.37 ms … 9.42 ms) · 10 × 16 |
| `/interactive` | 2.69 ms ± 0.39 ms (2.21 ms … 3.44 ms) · 10 × 64  | 5.64 ms ± 1.01 ms (4.43 ms … 7.90 ms) · 10 × 16 | 5.03 ms ± 1.20 ms (3.31 ms … 7.41 ms) · 10 × 16  | 5.44 ms ± 0.58 ms (4.85 ms … 6.42 ms) · 10 × 32 |
| `/api/health`  | 0.37 ms ± 0.12 ms (0.24 ms … 0.64 ms) · 10 × 256 | 1.65 ms ± 0.23 ms (1.34 ms … 2.12 ms) · 10 × 64 | 0.93 ms ± 0.24 ms (0.63 ms … 1.41 ms) · 10 × 128 | 1.69 ms ± 0.22 ms (1.26 ms … 2.03 ms) · 10 × 64 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start | Waku    |
| ------------------- | ------- | ------- | -------------- | ------- |
| first byte (median) | 4.79 ms | 7.65 ms | 7.78 ms        | 7.47 ms |
| last byte (median)  | 4.80 ms | 8.58 ms | 7.80 ms        | 7.50 ms |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            | Waku                                      |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 210 rps · 3.31 ms · 21.2 ms · 4.45 ms CPU | 116 rps · 6.25 ms · 38.5 ms · 8.29 ms CPU | 117 rps · 6.50 ms · 45.3 ms · 8.14 ms CPU | 137 rps · 6.41 ms · 23.1 ms · 6.05 ms CPU |
| 8           | 252 rps · 25.1 ms · 86.2 ms · 3.94 ms CPU | 99 rps · 76.0 ms · 157 ms · 10.00 ms CPU  | 122 rps · 55.9 ms · 155 ms · 8.08 ms CPU  | 183 rps · 34.2 ms · 109 ms · 5.42 ms CPU  |
| 32          | 239 rps · 122 ms · 331 ms · 4.10 ms CPU   | 86 rps · 418 ms · 476 ms · 11.43 ms CPU   | 126 rps · 248 ms · 464 ms · 7.88 ms CPU   | 151 rps · 202 ms · 461 ms · 6.52 ms CPU   |
| 128         | 232 rps · 239 ms · 5.51 s · 4.16 ms CPU   | 102 rps · 685 ms · 5.67 s · 9.36 ms CPU   | 128 rps · 378 ms · 5.92 s · 7.38 ms CPU   | 157 rps · 338 ms · 5.56 s · 6.15 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              | Waku                                        |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 6,143 rps · 0.12 ms · 0.55 ms · 0.09 ms CPU  | 826 rps · 0.91 ms · 7.27 ms · 1.07 ms CPU   | 2,743 rps · 0.19 ms · 3.86 ms · 0.28 ms CPU | 1,011 rps · 0.84 ms · 2.88 ms · 0.76 ms CPU |
| 8           | 12,645 rps · 0.51 ms · 1.54 ms · 0.07 ms CPU | 1,135 rps · 5.54 ms · 35.8 ms · 0.86 ms CPU | 3,682 rps · 1.14 ms · 17.8 ms · 0.26 ms CPU | 1,309 rps · 5.01 ms · 16.7 ms · 0.75 ms CPU |
| 32          | 14,053 rps · 2.26 ms · 4.88 ms · 0.07 ms CPU | 1,199 rps · 22.7 ms · 78.6 ms · 0.82 ms CPU | 3,719 rps · 5.28 ms · 52.7 ms · 0.26 ms CPU | 1,379 rps · 20.7 ms · 50.9 ms · 0.71 ms CPU |
| 128         | 13,481 rps · 9.59 ms · 15.7 ms · 0.07 ms CPU | 1,295 rps · 88.5 ms · 165 ms · 0.76 ms CPU  | 4,158 rps · 25.9 ms · 95.6 ms · 0.24 ms CPU | 1,428 rps · 86.0 ms · 130 ms · 0.69 ms CPU  |

|                                       | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------------------------- | --------- | --------- | -------------- | --------- |
| largest process, peak resident memory | 152.78 MB | 204.39 MB | 206.39 MB      | 173.94 MB |

### 1 core, 128 MB heap

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                         | TanStack Start                                   | Waku                                            |
| -------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `/`            | 0.91 ms ± 0.27 ms (0.61 ms … 1.45 ms) · 10 × 128 | 1.79 ms ± 0.31 ms (1.39 ms … 2.45 ms) · 10 × 64 | 2.24 ms ± 0.35 ms (1.80 ms … 2.98 ms) · 10 × 64  | 1.56 ms ± 0.19 ms (1.29 ms … 1.85 ms) · 10 × 64 |
| `/ssr`         | 5.25 ms ± 0.63 ms (4.24 ms … 6.25 ms) · 10 × 16  | 11.3 ms ± 2.67 ms (7.90 ms … 15.6 ms) · 10 × 8  | 9.43 ms ± 1.53 ms (7.67 ms … 11.5 ms) · 10 × 16  | 9.80 ms ± 1.66 ms (7.31 ms … 13.2 ms) · 10 × 16 |
| `/interactive` | 2.38 ms ± 0.31 ms (1.81 ms … 2.83 ms) · 10 × 64  | 6.17 ms ± 0.97 ms (4.89 ms … 8.35 ms) · 10 × 16 | 4.40 ms ± 0.72 ms (3.53 ms … 5.66 ms) · 10 × 32  | 5.63 ms ± 0.84 ms (4.47 ms … 6.83 ms) · 10 × 16 |
| `/api/health`  | 0.33 ms ± 0.08 ms (0.23 ms … 0.46 ms) · 10 × 256 | 1.83 ms ± 0.38 ms (1.43 ms … 2.52 ms) · 10 × 64 | 0.92 ms ± 0.17 ms (0.65 ms … 1.18 ms) · 10 × 128 | 1.45 ms ± 0.21 ms (1.08 ms … 1.76 ms) · 10 × 64 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start | Waku    |
| ------------------- | ------- | ------- | -------------- | ------- |
| first byte (median) | 3.06 ms | 7.52 ms | 7.65 ms        | 6.60 ms |
| last byte (median)  | 3.07 ms | 8.14 ms | 7.67 ms        | 6.64 ms |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                           | Waku                                      |
| ----------- | ----------------------------------------- | ----------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| 1           | 209 rps · 3.24 ms · 22.1 ms · 4.46 ms CPU | 115 rps · 6.52 ms · 39.6 ms · 8.38 ms CPU | 97 rps · 8.56 ms · 47.3 ms · 9.81 ms CPU | 126 rps · 7.08 ms · 22.9 ms · 6.74 ms CPU |
| 8           | 208 rps · 32.2 ms · 96.6 ms · 4.73 ms CPU | 119 rps · 59.5 ms · 121 ms · 8.30 ms CPU  | 122 rps · 54.2 ms · 152 ms · 8.18 ms CPU | 176 rps · 37.6 ms · 107 ms · 5.62 ms CPU  |
| 32          | 233 rps · 130 ms · 249 ms · 4.25 ms CPU   | 102 rps · 332 ms · 1.19 s · 9.53 ms CPU   | 128 rps · 244 ms · 491 ms · 7.76 ms CPU  | 149 rps · 205 ms · 444 ms · 6.55 ms CPU   |
| 128         | 245 rps · 239 ms · 5.54 s · 3.91 ms CPU   | 103 rps · 637 ms · 5.81 s · 9.10 ms CPU   | 112 rps · 414 ms · 6.47 s · 8.27 ms CPU  | 146 rps · 394 ms · 5.49 s · 6.62 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              | Waku                                        |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 7,051 rps · 0.11 ms · 0.43 ms · 0.09 ms CPU  | 809 rps · 0.92 ms · 6.54 ms · 1.07 ms CPU   | 1,988 rps · 0.37 ms · 4.51 ms · 0.36 ms CPU | 839 rps · 1.07 ms · 3.52 ms · 0.94 ms CPU   |
| 8           | 11,302 rps · 0.52 ms · 2.01 ms · 0.08 ms CPU | 1,147 rps · 5.36 ms · 35.2 ms · 0.86 ms CPU | 3,319 rps · 1.49 ms · 18.7 ms · 0.29 ms CPU | 1,358 rps · 4.98 ms · 15.1 ms · 0.73 ms CPU |
| 32          | 11,559 rps · 2.47 ms · 6.40 ms · 0.08 ms CPU | 1,280 rps · 22.3 ms · 72.6 ms · 0.77 ms CPU | 4,020 rps · 4.73 ms · 50.9 ms · 0.24 ms CPU | 1,280 rps · 21.9 ms · 52.5 ms · 0.78 ms CPU |
| 128         | 12,341 rps · 10.1 ms · 18.1 ms · 0.08 ms CPU | 1,240 rps · 69.7 ms · 2.30 s · 0.80 ms CPU  | 3,304 rps · 30.7 ms · 134 ms · 0.30 ms CPU  | 1,356 rps · 85.6 ms · 143 ms · 0.72 ms CPU  |

|                                       | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------------------------- | --------- | --------- | -------------- | --------- |
| largest process, peak resident memory | 159.14 MB | 207.22 MB | 210.43 MB      | 170.68 MB |

### Node 24.22.3, all cores

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                          | TanStack Start                                   | Waku                                            |
| -------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `/`            | 0.82 ms ± 0.19 ms (0.56 ms … 1.05 ms) · 10 × 128 | 1.49 ms ± 0.31 ms (1.02 ms … 1.98 ms) · 10 × 64  | 1.92 ms ± 0.40 ms (1.51 ms … 2.56 ms) · 10 × 64  | 1.67 ms ± 0.30 ms (1.33 ms … 2.18 ms) · 10 × 64 |
| `/ssr`         | 6.58 ms ± 1.13 ms (5.16 ms … 8.10 ms) · 10 × 16  | 7.62 ms ± 0.89 ms (6.18 ms … 9.15 ms) · 10 × 16  | 8.94 ms ± 1.88 ms (6.62 ms … 12.0 ms) · 10 × 16  | 8.24 ms ± 1.32 ms (6.59 ms … 10.4 ms) · 10 × 16 |
| `/interactive` | 2.47 ms ± 0.26 ms (1.85 ms … 2.77 ms) · 10 × 32  | 4.14 ms ± 0.60 ms (3.54 ms … 5.28 ms) · 10 × 32  | 4.35 ms ± 1.10 ms (3.17 ms … 6.10 ms) · 10 × 32  | 4.71 ms ± 0.35 ms (4.04 ms … 5.12 ms) · 10 × 32 |
| `/api/health`  | 0.45 ms ± 0.13 ms (0.25 ms … 0.71 ms) · 10 × 128 | 1.30 ms ± 0.20 ms (1.05 ms … 1.63 ms) · 10 × 128 | 0.63 ms ± 0.19 ms (0.38 ms … 0.95 ms) · 10 × 256 | 1.28 ms ± 0.10 ms (1.19 ms … 1.45 ms) · 10 × 64 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start | Waku    |
| ------------------- | ------- | ------- | -------------- | ------- |
| first byte (median) | 3.14 ms | 5.69 ms | 6.44 ms        | 6.86 ms |
| last byte (median)  | 3.15 ms | 6.17 ms | 6.45 ms        | 6.88 ms |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            | Waku                                      |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 221 rps · 3.36 ms · 21.4 ms · 4.96 ms CPU | 166 rps · 5.13 ms · 16.1 ms · 7.49 ms CPU | 99 rps · 9.97 ms · 30.3 ms · 12.03 ms CPU | 148 rps · 6.11 ms · 12.3 ms · 5.94 ms CPU |
| 8           | 287 rps · 22.6 ms · 63.6 ms · 4.05 ms CPU | 158 rps · 44.5 ms · 109 ms · 7.73 ms CPU  | 127 rps · 55.5 ms · 139 ms · 9.76 ms CPU  | 200 rps · 34.6 ms · 100 ms · 5.53 ms CPU  |
| 32          | 270 rps · 110 ms · 223 ms · 4.26 ms CPU   | 186 rps · 168 ms · 235 ms · 6.56 ms CPU   | 129 rps · 236 ms · 488 ms · 9.02 ms CPU   | 200 rps · 145 ms · 338 ms · 5.46 ms CPU   |
| 128         | 278 rps · 212 ms · 5.47 s · 4.04 ms CPU   | 182 rps · 436 ms · 5.42 s · 6.66 ms CPU   | 120 rps · 409 ms · 6.01 s · 9.90 ms CPU   | 188 rps · 301 ms · 5.48 s · 5.80 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                              | Waku                                        |
| ----------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| 1           | 7,607 rps · 0.10 ms · 0.35 ms · 0.08 ms CPU  | 984 rps · 0.84 ms · 3.22 ms · 0.95 ms CPU   | 2,412 rps · 0.35 ms · 1.02 ms · 0.36 ms CPU | 789 rps · 1.12 ms · 3.09 ms · 1.01 ms CPU   |
| 8           | 14,665 rps · 0.45 ms · 1.41 ms · 0.06 ms CPU | 1,310 rps · 5.13 ms · 17.1 ms · 0.86 ms CPU | 5,534 rps · 0.91 ms · 9.53 ms · 0.20 ms CPU | 1,255 rps · 5.26 ms · 15.2 ms · 0.84 ms CPU |
| 32          | 16,591 rps · 1.84 ms · 4.38 ms · 0.06 ms CPU | 1,398 rps · 20.3 ms · 49.9 ms · 0.76 ms CPU | 5,787 rps · 3.84 ms · 21.9 ms · 0.19 ms CPU | 1,496 rps · 19.7 ms · 40.9 ms · 0.68 ms CPU |
| 128         | 17,456 rps · 7.42 ms · 15.1 ms · 0.05 ms CPU | 1,479 rps · 84.1 ms · 131 ms · 0.74 ms CPU  | 5,682 rps · 17.3 ms · 64.5 ms · 0.19 ms CPU | 1,289 rps · 91.0 ms · 177 ms · 0.77 ms CPU  |

|                                       | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------------------------- | --------- | --------- | -------------- | --------- |
| largest process, peak resident memory | 314.15 MB | 370.91 MB | 382.65 MB      | 314.13 MB |

### Bun 1.4.4, all cores

**One request at a time** — no queue, no contention: what an answer costs when nothing else is happening. `mean ± σ (min … max)` over the samples; each sample is the mean of a batch sized so one batch runs for at least 100 ms.

| Route          | rsvhono                                          | Next.js                                          | TanStack Start                                   | Waku                                             |
| -------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `/`            | 0.37 ms ± 0.11 ms (0.23 ms … 0.57 ms) · 10 × 256 | 1.46 ms ± 0.16 ms (1.12 ms … 1.69 ms) · 10 × 64  | 1.43 ms ± 0.17 ms (1.17 ms … 1.74 ms) · 10 × 64  | 0.69 ms ± 0.24 ms (0.45 ms … 1.18 ms) · 10 × 128 |
| `/ssr`         | 3.56 ms ± 0.51 ms (2.90 ms … 4.70 ms) · 10 × 32  | 9.28 ms ± 2.03 ms (6.17 ms … 13.1 ms) · 10 × 8   | 6.33 ms ± 0.77 ms (5.26 ms … 7.29 ms) · 10 × 16  | 5.46 ms ± 0.77 ms (4.57 ms … 6.48 ms) · 10 × 16  |
| `/interactive` | 1.45 ms ± 0.15 ms (1.23 ms … 1.72 ms) · 10 × 128 | 3.51 ms ± 0.70 ms (2.95 ms … 5.04 ms) · 10 × 32  | 2.98 ms ± 0.47 ms (2.32 ms … 3.96 ms) · 10 × 32  | 3.56 ms ± 0.33 ms (3.10 ms … 4.12 ms) · 10 × 32  |
| `/api/health`  | 0.28 ms ± 0.07 ms (0.19 ms … 0.42 ms) · 10 × 512 | 0.99 ms ± 0.11 ms (0.83 ms … 1.18 ms) · 10 × 128 | 0.33 ms ± 0.07 ms (0.23 ms … 0.45 ms) · 10 × 256 | 0.42 ms ± 0.14 ms (0.24 ms … 0.68 ms) · 10 × 256 |

| `/ssr`, one request | rsvhono | Next.js | TanStack Start | Waku    |
| ------------------- | ------- | ------- | -------------- | ------- |
| first byte (median) | 2.51 ms | 4.73 ms | 4.98 ms        | 4.29 ms |
| last byte (median)  | 2.52 ms | 4.97 ms | 5.13 ms        | 4.31 ms |

**`/ssr` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                   | Next.js                                   | TanStack Start                            | Waku                                      |
| ----------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| 1           | 317 rps · 2.50 ms · 8.27 ms · 2.96 ms CPU | 219 rps · 4.06 ms · 9.94 ms · 5.03 ms CPU | 187 rps · 4.69 ms · 10.6 ms · 5.66 ms CPU | 219 rps · 4.12 ms · 8.69 ms · 3.85 ms CPU |
| 8           | 304 rps · 24.4 ms · 69.6 ms · 3.42 ms CPU | 242 rps · 32.0 ms · 55.7 ms · 4.56 ms CPU | 201 rps · 35.3 ms · 85.3 ms · 5.25 ms CPU | 364 rps · 18.3 ms · 48.9 ms · 2.97 ms CPU |
| 32          | 375 rps · 82.9 ms · 167 ms · 2.94 ms CPU  | 213 rps · 152 ms · 191 ms · 5.49 ms CPU   | 195 rps · 157 ms · 309 ms · 5.58 ms CPU   | 340 rps · 85.5 ms · 192 ms · 3.29 ms CPU  |
| 128         | 351 rps · 347 ms · 496 ms · 3.07 ms CPU   | 227 rps · 598 ms · 837 ms · 5.10 ms CPU   | 187 rps · 685 ms · 801 ms · 5.68 ms CPU   | 320 rps · 408 ms · 798 ms · 3.44 ms CPU   |

**`/api/health` as concurrency rises** — requests per second · median · 99th percentile · CPU per request.

| Connections | rsvhono                                      | Next.js                                     | TanStack Start                               | Waku                                        |
| ----------- | -------------------------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| 1           | 9,302 rps · 0.08 ms · 0.32 ms · 0.06 ms CPU  | 1,582 rps · 0.56 ms · 2.32 ms · 0.59 ms CPU | 6,503 rps · 0.12 ms · 0.41 ms · 0.12 ms CPU  | 4,945 rps · 0.15 ms · 0.62 ms · 0.15 ms CPU |
| 8           | 27,299 rps · 0.21 ms · 1.32 ms · 0.03 ms CPU | 2,170 rps · 3.04 ms · 9.23 ms · 0.48 ms CPU | 10,858 rps · 0.57 ms · 2.92 ms · 0.09 ms CPU | 8,508 rps · 0.72 ms · 2.90 ms · 0.11 ms CPU |
| 32          | 25,748 rps · 1.05 ms · 3.56 ms · 0.03 ms CPU | 2,318 rps · 12.2 ms · 28.2 ms · 0.44 ms CPU | 14,189 rps · 2.11 ms · 4.72 ms · 0.07 ms CPU | 9,412 rps · 3.11 ms · 6.78 ms · 0.10 ms CPU |
| 128         | 27,926 rps · 4.07 ms · 9.52 ms · 0.03 ms CPU | 2,647 rps · 46.1 ms · 86.7 ms · 0.38 ms CPU | 13,873 rps · 8.99 ms · 16.3 ms · 0.07 ms CPU | 9,300 rps · 13.0 ms · 25.2 ms · 0.11 ms CPU |

|                                       | rsvhono   | Next.js   | TanStack Start | Waku      |
| ------------------------------------- | --------- | --------- | -------------- | --------- |
| largest process, peak resident memory | 133.65 MB | 288.48 MB | 314.34 MB      | 256.63 MB |

## In the browser, by device

Chromium 153.0.8010.12, 7 isolated first visits per cell — nothing cached. Throttling is applied through the DevTools protocol, to the browser only; the server is the same unthrottled process in every profile. Bytes are gzip level 6, applied by the harness to every target: no app compresses, and none is left to its server's default.

Timings are `mean ± σ (min … max)`; sizes and counts are medians.

### desktop, unthrottled

**`/`**

|                                   | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| --------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                | 7.66 ms ± 4.35 ms (4.10 ms … 17.1 ms) | 10.8 ms ± 7.15 ms (6.80 ms … 26.9 ms) | 12.2 ms ± 9.22 ms (6.40 ms … 32.9 ms) | 6.40 ms ± 1.42 ms (5.20 ms … 9.10 ms) |
| first contentful paint            | 72.0 ms ± 11.3 ms (52.0 ms … 88.0 ms) | 97.1 ms ± 32.6 ms (64.0 ms … 152 ms)  | 71.4 ms ± 10.4 ms (52.0 ms … 84.0 ms) | 85.7 ms ± 10.8 ms (72.0 ms … 104 ms)  |
| largest contentful paint          | 72.0 ms ± 11.3 ms (52.0 ms … 88.0 ms) | 97.1 ms ± 32.6 ms (64.0 ms … 152 ms)  | 71.4 ms ± 10.4 ms (52.0 ms … 84.0 ms) | 85.7 ms ± 10.8 ms (72.0 ms … 104 ms)  |
| total blocking time               | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time           | 18.4 ms ± 3.48 ms (15.6 ms … 25.0 ms) | 35.4 ms ± 6.19 ms (27.3 ms … 46.0 ms) | 39.9 ms ± 5.33 ms (32.6 ms … 48.5 ms) | 22.7 ms ± 4.56 ms (18.4 ms … 31.7 ms) |
| soft navigation to `/ssr`         | 88.9 ms ± 25.2 ms (61.0 ms … 139 ms)  | 114 ms ± 14.5 ms (98.0 ms … 134 ms)   | 95.1 ms ± 21.8 ms (74.0 ms … 136 ms)  | 81.6 ms ± 22.0 ms (67.0 ms … 131 ms)  |
| bytes on the wire (gzip)          | 85.9 kB                               | 158.1 kB                              | 117.3 kB                              | 91.7 kB                               |
| of which JavaScript               | 82.7 kB                               | 149.1 kB                              | 113.4 kB                              | 88.3 kB                               |
| requests                          | 4                                     | 16                                    | 4                                     | 6                                     |
| JS heap after GC                  | 2.18 MB                               | 2.96 MB                               | 2.60 MB                               | 2.27 MB                               |
| soft navigation, bytes            | 4.3 kB                                | 4.2 kB                                | 29.5 kB                               | 28.6 kB                               |
| soft navigation, requests         | 1                                     | 1                                     | 2                                     | 1                                     |
| soft navigation kept the document | yes                                   | yes                                   | yes                                   | yes                                   |

**`/ssr`**

|                          | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| ------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte       | 24.3 ms ± 20.9 ms (8.30 ms … 69.3 ms) | 27.2 ms ± 13.5 ms (14.8 ms … 53.7 ms) | 19.3 ms ± 7.18 ms (12.3 ms … 33.6 ms) | 28.2 ms ± 16.8 ms (12.6 ms … 63.4 ms) |
| first contentful paint   | 110 ms ± 19.2 ms (96.0 ms … 152 ms)   | 134 ms ± 21.3 ms (104 ms … 172 ms)    | 110 ms ± 15.1 ms (92.0 ms … 136 ms)   | 145 ms ± 27.8 ms (92.0 ms … 176 ms)   |
| largest contentful paint | 110 ms ± 19.2 ms (96.0 ms … 152 ms)   | 134 ms ± 21.3 ms (104 ms … 172 ms)    | 110 ms ± 15.1 ms (92.0 ms … 136 ms)   | 145 ms ± 27.8 ms (92.0 ms … 176 ms)   |
| total blocking time      | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 1.29 ms ± 3.40 ms (0.00 ms … 9.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time  | 29.2 ms ± 4.76 ms (22.5 ms … 34.8 ms) | 45.8 ms ± 6.34 ms (36.9 ms … 56.6 ms) | 50.9 ms ± 5.95 ms (44.2 ms … 62.2 ms) | 35.7 ms ± 6.13 ms (28.5 ms … 44.5 ms) |
| bytes on the wire (gzip) | 90.8 kB                               | 162.2 kB                              | 165.6 kB                              | 96.5 kB                               |
| of which JavaScript      | 82.7 kB                               | 149.1 kB                              | 113.1 kB                              | 88.2 kB                               |
| requests                 | 4                                     | 15                                    | 4                                     | 6                                     |
| JS heap after GC         | 2.49 MB                               | 3.26 MB                               | 2.99 MB                               | 2.59 MB                               |

**`/interactive`**

|                                     | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| ----------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                  | 7.16 ms ± 1.59 ms (5.80 ms … 10.1 ms) | 14.7 ms ± 3.33 ms (10.6 ms … 19.1 ms) | 12.4 ms ± 3.25 ms (8.60 ms … 18.9 ms) | 13.3 ms ± 3.67 ms (9.20 ms … 20.4 ms) |
| first contentful paint              | 84.0 ms ± 5.66 ms (80.0 ms … 92.0 ms) | 128 ms ± 29.2 ms (80.0 ms … 168 ms)   | 96.0 ms ± 13.1 ms (76.0 ms … 116 ms)  | 117 ms ± 19.9 ms (88.0 ms … 144 ms)   |
| largest contentful paint            | 84.0 ms ± 5.66 ms (80.0 ms … 92.0 ms) | 128 ms ± 29.2 ms (80.0 ms … 168 ms)   | 96.0 ms ± 13.1 ms (76.0 ms … 116 ms)  | 117 ms ± 19.9 ms (88.0 ms … 144 ms)   |
| total blocking time                 | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) |
| main-thread script time             | 30.2 ms ± 6.53 ms (21.6 ms … 40.3 ms) | 41.9 ms ± 4.52 ms (35.1 ms … 47.5 ms) | 47.1 ms ± 6.77 ms (37.8 ms … 58.9 ms) | 32.2 ms ± 6.51 ms (24.2 ms … 39.9 ms) |
| hydrated (counter answers a click)  | 130 ms ± 13.8 ms (108 ms … 145 ms)    | 202 ms ± 30.6 ms (168 ms … 242 ms)    | 163 ms ± 14.3 ms (147 ms … 183 ms)    | 164 ms ± 11.8 ms (145 ms … 176 ms)    |
| click → paint                       | 1.76 ms ± 0.25 ms (1.40 ms … 2.10 ms) | 2.53 ms ± 0.49 ms (2.10 ms … 3.50 ms) | 2.37 ms ± 0.50 ms (1.90 ms … 3.30 ms) | 2.36 ms ± 0.52 ms (1.90 ms … 3.10 ms) |
| keystroke → paint (filter 100 rows) | 7.26 ms ± 4.17 ms (2.50 ms … 13.2 ms) | 9.86 ms ± 5.63 ms (3.80 ms … 16.3 ms) | 7.89 ms ± 3.76 ms (4.30 ms … 13.1 ms) | 10.6 ms ± 4.11 ms (5.00 ms … 14.9 ms) |
| mutation round trip                 | 67.1 ms ± 4.85 ms (62.0 ms … 75.0 ms) | 79.6 ms ± 12.4 ms (55.0 ms … 93.0 ms) | 73.0 ms ± 12.5 ms (53.0 ms … 92.0 ms) | 82.1 ms ± 13.3 ms (65.0 ms … 104 ms)  |
| bytes on the wire (gzip)            | 89.6 kB                               | 161.8 kB                              | 136.8 kB                              | 95.1 kB                               |
| of which JavaScript                 | 84.0 kB                               | 150.5 kB                              | 115.6 kB                              | 89.3 kB                               |
| requests                            | 5                                     | 17                                    | 6                                     | 7                                     |
| JS heap after GC                    | 2.86 MB                               | 3.61 MB                               | 3.30 MB                               | 2.96 MB                               |
| mutation, bytes                     | 3.2 kB                                | 481 B                                 | 439 B                                 | 267 B                                 |

### mid-tier mobile (4× CPU, Slow 4G)

**`/`**

|                                   | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| --------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                | 6.83 ms ± 3.93 ms (4.40 ms … 15.3 ms) | 9.16 ms ± 2.40 ms (6.10 ms … 11.8 ms) | 6.86 ms ± 2.88 ms (4.20 ms … 10.8 ms) | 10.0 ms ± 2.98 ms (7.00 ms … 14.1 ms) |
| first contentful paint            | 403 ms ± 6.70 ms (392 ms … 412 ms)    | 430 ms ± 20.1 ms (408 ms … 468 ms)    | 405 ms ± 9.07 ms (392 ms … 420 ms)    | 432 ms ± 20.3 ms (404 ms … 460 ms)    |
| largest contentful paint          | 403 ms ± 6.70 ms (392 ms … 412 ms)    | 430 ms ± 20.1 ms (408 ms … 468 ms)    | 405 ms ± 9.07 ms (392 ms … 420 ms)    | 432 ms ± 20.3 ms (404 ms … 460 ms)    |
| total blocking time               | 2.14 ms ± 5.67 ms (0.00 ms … 15.0 ms) | 134 ms ± 34.5 ms (84.0 ms … 170 ms)   | 0.86 ms ± 2.27 ms (0.00 ms … 6.00 ms) | 1.71 ms ± 2.93 ms (0.00 ms … 8.00 ms) |
| main-thread script time           | 73.7 ms ± 20.9 ms (55.6 ms … 119 ms)  | 154 ms ± 19.7 ms (134 ms … 181 ms)    | 157 ms ± 23.3 ms (121 ms … 188 ms)    | 111 ms ± 18.8 ms (86.3 ms … 137 ms)   |
| soft navigation to `/ssr`         | 377 ms ± 45.2 ms (328 ms … 428 ms)    | 447 ms ± 34.7 ms (401 ms … 506 ms)    | 533 ms ± 35.3 ms (496 ms … 605 ms)    | 750 ms ± 243 ms (471 ms … 960 ms)     |
| bytes on the wire (gzip)          | 85.9 kB                               | 158.7 kB                              | 117.3 kB                              | 91.6 kB                               |
| of which JavaScript               | 82.7 kB                               | 149.1 kB                              | 113.4 kB                              | 88.2 kB                               |
| requests                          | 4                                     | 17                                    | 4                                     | 6                                     |
| JS heap after GC                  | 2.18 MB                               | 2.97 MB                               | 2.61 MB                               | 2.27 MB                               |
| soft navigation, bytes            | 4.3 kB                                | 4.2 kB                                | 29.5 kB                               | 0 B                                   |
| soft navigation, requests         | 1                                     | 1                                     | 2                                     | 0                                     |
| soft navigation kept the document | yes                                   | yes                                   | yes                                   | yes                                   |

**`/ssr`**

|                          | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| ------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte       | 14.2 ms ± 4.02 ms (9.60 ms … 18.9 ms) | 31.1 ms ± 9.04 ms (22.4 ms … 46.2 ms) | 19.1 ms ± 5.39 ms (14.0 ms … 30.7 ms) | 20.1 ms ± 7.63 ms (10.6 ms … 32.9 ms) |
| first contentful paint   | 448 ms ± 23.4 ms (428 ms … 492 ms)    | 497 ms ± 37.7 ms (440 ms … 564 ms)    | 463 ms ± 25.7 ms (440 ms … 516 ms)    | 487 ms ± 33.2 ms (452 ms … 532 ms)    |
| largest contentful paint | 448 ms ± 23.4 ms (428 ms … 492 ms)    | 497 ms ± 37.7 ms (440 ms … 564 ms)    | 463 ms ± 25.7 ms (440 ms … 516 ms)    | 487 ms ± 33.2 ms (452 ms … 532 ms)    |
| total blocking time      | 0.00 ms ± 0.00 ms (0.00 ms … 0.00 ms) | 146 ms ± 34.4 ms (104 ms … 190 ms)    | 5.43 ms ± 9.90 ms (0.00 ms … 25.0 ms) | 8.86 ms ± 9.63 ms (0.00 ms … 27.0 ms) |
| main-thread script time  | 83.8 ms ± 6.88 ms (73.3 ms … 90.3 ms) | 189 ms ± 28.0 ms (163 ms … 243 ms)    | 174 ms ± 11.3 ms (161 ms … 190 ms)    | 127 ms ± 15.8 ms (110 ms … 149 ms)    |
| bytes on the wire (gzip) | 90.8 kB                               | 163.6 kB                              | 165.6 kB                              | 96.5 kB                               |
| of which JavaScript      | 82.7 kB                               | 149.1 kB                              | 113.1 kB                              | 88.2 kB                               |
| requests                 | 4                                     | 17                                    | 4                                     | 6                                     |
| JS heap after GC         | 2.49 MB                               | 3.27 MB                               | 3.00 MB                               | 2.59 MB                               |

**`/interactive`**

|                                     | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| ----------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                  | 7.99 ms ± 1.61 ms (6.00 ms … 10.3 ms) | 17.2 ms ± 6.91 ms (11.6 ms … 29.0 ms) | 12.9 ms ± 3.97 ms (9.20 ms … 21.5 ms) | 13.4 ms ± 3.48 ms (8.50 ms … 19.8 ms) |
| first contentful paint              | 419 ms ± 21.0 ms (392 ms … 444 ms)    | 433 ms ± 13.2 ms (420 ms … 460 ms)    | 426 ms ± 13.0 ms (404 ms … 436 ms)    | 445 ms ± 10.2 ms (432 ms … 460 ms)    |
| largest contentful paint            | 419 ms ± 21.0 ms (392 ms … 444 ms)    | 433 ms ± 13.2 ms (420 ms … 460 ms)    | 426 ms ± 13.0 ms (404 ms … 436 ms)    | 445 ms ± 10.2 ms (432 ms … 460 ms)    |
| total blocking time                 | 0.86 ms ± 2.27 ms (0.00 ms … 6.00 ms) | 183 ms ± 26.3 ms (142 ms … 220 ms)    | 12.4 ms ± 11.5 ms (3.00 ms … 35.0 ms) | 13.7 ms ± 20.2 ms (0.00 ms … 49.0 ms) |
| main-thread script time             | 99.5 ms ± 19.3 ms (72.0 ms … 133 ms)  | 162 ms ± 11.0 ms (140 ms … 173 ms)    | 179 ms ± 27.0 ms (148 ms … 231 ms)    | 166 ms ± 45.7 ms (125 ms … 245 ms)    |
| hydrated (counter answers a click)  | 957 ms ± 27.5 ms (919 ms … 995 ms)    | 1.46 s ± 31.4 ms (1.41 s … 1.51 s)    | 1.22 s ± 37.3 ms (1.19 s … 1.29 s)    | 1.01 s ± 70.9 ms (943 ms … 1.14 s)    |
| click → paint                       | 9.34 ms ± 2.15 ms (7.00 ms … 13.4 ms) | 10.1 ms ± 1.81 ms (8.00 ms … 13.3 ms) | 12.0 ms ± 2.55 ms (8.00 ms … 15.3 ms) | 10.3 ms ± 1.82 ms (7.20 ms … 12.5 ms) |
| keystroke → paint (filter 100 rows) | 16.4 ms ± 3.16 ms (11.2 ms … 19.7 ms) | 16.2 ms ± 4.86 ms (11.1 ms … 24.1 ms) | 20.7 ms ± 3.32 ms (13.9 ms … 24.1 ms) | 22.7 ms ± 4.12 ms (14.8 ms … 26.9 ms) |
| mutation round trip                 | 294 ms ± 22.8 ms (264 ms … 331 ms)    | 317 ms ± 20.7 ms (289 ms … 350 ms)    | 326 ms ± 26.4 ms (290 ms … 375 ms)    | 318 ms ± 24.9 ms (278 ms … 346 ms)    |
| bytes on the wire (gzip)            | 89.6 kB                               | 162.6 kB                              | 136.8 kB                              | 95.1 kB                               |
| of which JavaScript                 | 84.0 kB                               | 150.5 kB                              | 115.6 kB                              | 89.3 kB                               |
| requests                            | 5                                     | 18                                    | 6                                     | 7                                     |
| JS heap after GC                    | 2.86 MB                               | 3.59 MB                               | 3.31 MB                               | 2.96 MB                               |
| mutation, bytes                     | 3.1 kB                                | 481 B                                 | 439 B                                 | 267 B                                 |

### low-end mobile (6× CPU, 3G)

**`/`**

|                                   | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| --------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                | 6.27 ms ± 1.92 ms (3.90 ms … 9.20 ms) | 7.76 ms ± 1.15 ms (6.50 ms … 9.30 ms) | 7.73 ms ± 2.14 ms (4.80 ms … 11.0 ms) | 6.83 ms ± 2.46 ms (4.40 ms … 11.8 ms) |
| first contentful paint            | 742 ms ± 13.2 ms (720 ms … 760 ms)    | 773 ms ± 29.8 ms (740 ms … 824 ms)    | 745 ms ± 6.82 ms (732 ms … 752 ms)    | 769 ms ± 38.3 ms (708 ms … 804 ms)    |
| largest contentful paint          | 742 ms ± 13.2 ms (720 ms … 760 ms)    | 773 ms ± 29.8 ms (740 ms … 824 ms)    | 745 ms ± 6.82 ms (732 ms … 752 ms)    | 769 ms ± 38.3 ms (708 ms … 804 ms)    |
| total blocking time               | 24.4 ms ± 28.6 ms (0.00 ms … 81.0 ms) | 262 ms ± 94.2 ms (163 ms … 393 ms)    | 14.9 ms ± 18.2 ms (0.00 ms … 45.0 ms) | 30.6 ms ± 26.4 ms (0.00 ms … 68.0 ms) |
| main-thread script time           | 133 ms ± 43.6 ms (80.5 ms … 212 ms)   | 222 ms ± 47.5 ms (174 ms … 312 ms)    | 230 ms ± 32.9 ms (186 ms … 274 ms)    | 186 ms ± 49.5 ms (135 ms … 260 ms)    |
| soft navigation to `/ssr`         | 961 ms ± 33.4 ms (914 ms … 1.00 s)    | 1.03 s ± 93.9 ms (942 ms … 1.18 s)    | 990 ms ± 29.1 ms (948 ms … 1.03 s)    | 981 ms ± 47.7 ms (946 ms … 1.08 s)    |
| bytes on the wire (gzip)          | 85.9 kB                               | 152.8 kB                              | 117.3 kB                              | 91.6 kB                               |
| of which JavaScript               | 82.7 kB                               | 149.1 kB                              | 113.4 kB                              | 88.2 kB                               |
| requests                          | 4                                     | 10                                    | 4                                     | 6                                     |
| JS heap after GC                  | 2.18 MB                               | 2.85 MB                               | 2.62 MB                               | 2.27 MB                               |
| soft navigation, bytes            | 4.3 kB                                | 10.1 kB                               | 29.5 kB                               | 0 B                                   |
| soft navigation, requests         | 1                                     | 8                                     | 2                                     | 0                                     |
| soft navigation kept the document | yes                                   | yes                                   | yes                                   | yes                                   |

**`/ssr`**

|                          | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| ------------------------ | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte       | 12.9 ms ± 2.62 ms (11.1 ms … 18.7 ms) | 33.1 ms ± 13.4 ms (23.8 ms … 54.5 ms) | 18.9 ms ± 5.75 ms (13.1 ms … 28.8 ms) | 19.2 ms ± 3.25 ms (12.1 ms … 21.7 ms) |
| first contentful paint   | 799 ms ± 26.8 ms (772 ms … 840 ms)    | 925 ms ± 84.6 ms (836 ms … 1.10 s)    | 836 ms ± 30.8 ms (796 ms … 896 ms)    | 848 ms ± 26.4 ms (816 ms … 900 ms)    |
| largest contentful paint | 799 ms ± 26.8 ms (772 ms … 840 ms)    | 925 ms ± 84.6 ms (836 ms … 1.10 s)    | 836 ms ± 30.8 ms (796 ms … 896 ms)    | 848 ms ± 26.4 ms (816 ms … 900 ms)    |
| total blocking time      | 20.7 ms ± 7.57 ms (5.00 ms … 29.0 ms) | 283 ms ± 69.4 ms (172 ms … 362 ms)    | 29.6 ms ± 31.4 ms (9.00 ms … 100 ms)  | 44.9 ms ± 14.2 ms (23.0 ms … 60.0 ms) |
| main-thread script time  | 127 ms ± 18.7 ms (95.3 ms … 148 ms)   | 327 ms ± 57.2 ms (212 ms … 383 ms)    | 274 ms ± 35.0 ms (225 ms … 317 ms)    | 194 ms ± 20.4 ms (169 ms … 216 ms)    |
| bytes on the wire (gzip) | 90.8 kB                               | 157.6 kB                              | 165.6 kB                              | 96.5 kB                               |
| of which JavaScript      | 82.7 kB                               | 149.1 kB                              | 113.1 kB                              | 88.2 kB                               |
| requests                 | 4                                     | 10                                    | 4                                     | 6                                     |
| JS heap after GC         | 2.49 MB                               | 3.16 MB                               | 3.00 MB                               | 2.60 MB                               |

**`/interactive`**

|                                     | rsvhono                               | Next.js                               | TanStack Start                        | Waku                                  |
| ----------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- | ------------------------------------- |
| time to first byte                  | 9.07 ms ± 2.78 ms (5.70 ms … 13.2 ms) | 14.9 ms ± 4.49 ms (9.20 ms … 21.1 ms) | 12.0 ms ± 3.34 ms (7.90 ms … 17.7 ms) | 14.5 ms ± 6.59 ms (9.00 ms … 28.3 ms) |
| first contentful paint              | 778 ms ± 27.8 ms (732 ms … 804 ms)    | 793 ms ± 48.6 ms (748 ms … 864 ms)    | 782 ms ± 20.0 ms (756 ms … 804 ms)    | 780 ms ± 24.5 ms (756 ms … 816 ms)    |
| largest contentful paint            | 778 ms ± 27.8 ms (732 ms … 804 ms)    | 793 ms ± 48.6 ms (748 ms … 864 ms)    | 782 ms ± 20.0 ms (756 ms … 804 ms)    | 780 ms ± 24.5 ms (756 ms … 816 ms)    |
| total blocking time                 | 13.9 ms ± 8.40 ms (0.00 ms … 25.0 ms) | 296 ms ± 96.5 ms (205 ms … 434 ms)    | 85.6 ms ± 33.6 ms (16.0 ms … 114 ms)  | 45.3 ms ± 15.6 ms (26.0 ms … 69.0 ms) |
| main-thread script time             | 174 ms ± 24.0 ms (133 ms … 209 ms)    | 242 ms ± 45.3 ms (199 ms … 318 ms)    | 305 ms ± 28.4 ms (271 ms … 348 ms)    | 247 ms ± 33.4 ms (211 ms … 300 ms)    |
| hydrated (counter answers a click)  | 1.96 s ± 45.3 ms (1.88 s … 2.03 s)    | 2.98 s ± 124 ms (2.86 s … 3.21 s)     | 2.52 s ± 66.5 ms (2.44 s … 2.64 s)    | 2.00 s ± 31.9 ms (1.97 s … 2.05 s)    |
| click → paint                       | 13.2 ms ± 3.57 ms (10.7 ms … 20.6 ms) | 17.2 ms ± 8.56 ms (9.20 ms … 29.9 ms) | 15.3 ms ± 3.08 ms (12.2 ms … 21.5 ms) | 18.9 ms ± 7.77 ms (12.0 ms … 30.5 ms) |
| keystroke → paint (filter 100 rows) | 23.1 ms ± 6.49 ms (17.0 ms … 36.5 ms) | 25.7 ms ± 14.0 ms (13.7 ms … 49.3 ms) | 28.1 ms ± 6.31 ms (19.9 ms … 35.9 ms) | 32.1 ms ± 15.9 ms (20.1 ms … 61.0 ms) |
| mutation round trip                 | 954 ms ± 20.8 ms (928 ms … 977 ms)    | 879 ms ± 203 ms (525 ms … 1.04 s)     | 975 ms ± 14.8 ms (956 ms … 995 ms)    | 763 ms ± 245 ms (464 ms … 982 ms)     |
| bytes on the wire (gzip)            | 89.6 kB                               | 158.6 kB                              | 136.8 kB                              | 95.1 kB                               |
| of which JavaScript                 | 84.0 kB                               | 150.5 kB                              | 115.6 kB                              | 89.3 kB                               |
| requests                            | 5                                     | 14                                    | 6                                     | 7                                     |
| JS heap after GC                    | 2.87 MB                               | 3.59 MB                               | 3.32 MB                               | 2.96 MB                               |
| mutation, bytes                     | 3.2 kB                                | 4.5 kB                                | 439 B                                 | 267 B                                 |

## Dev server startup

`dev` command to a served `/interactive` — which every one of these compiles lazily, so it includes compiling a route with three client components rather than just binding a socket. Cold clears the dev cache first.

HMR round-trip is the other number worth having here and is not measured: it needs a browser driving the page to assert the patch arrived.

| Metric         | rsvhono   | Next.js    | TanStack Start | Waku      |
| -------------- | --------- | ---------- | -------------- | --------- |
| Cold dev start | 3.02s ±6% | 4.43s ±17% | 4.83s ±3%      | 2.91s ±4% |
| Warm dev start | 2.89s ±6% | 4.32s ±15% | 4.44s ±2%      | 2.73s ±2% |

## Footprint

A production-only install (`--omit=dev`) into a throwaway directory, and the application code the spec took to express.

| Metric              | rsvhono  | Next.js   | TanStack Start | Waku     |
| ------------------- | -------- | --------- | -------------- | -------- |
| Prod install size   | 76.44 MB | 298.74 MB | 61.81 MB       | 76.54 MB |
| Packages installed  | 96       | 22        | 97             | 98       |
| Direct dependencies | 4        | 3         | 4              | 4        |
| App source files    | 16       | 16        | 18             | 16       |
| App source lines    | 457      | 458       | 666            | 481      |
