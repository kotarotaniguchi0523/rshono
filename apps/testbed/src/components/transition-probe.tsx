import type { PageProps } from '@rsvhono/core';
import { Layout } from './layout';
import { NavInfo } from './nav-info';
import { TransitionProbePanel } from './transition-probe-panel';

/** Not inside a `<Suspense>`: the payload's root arrives at once, and the render that shows it waits here. */
async function SlowBody({ ms }: { ms: number }) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return <p data-probe-body>body after {ms}ms</p>;
}

/**
 * `/transition-probe` — and `?body=<ms>`, which keeps a navigation to it pending *inside React*: the payload
 * is in hand and the transition rendering it is suspended. That is the state the probes are measured against.
 */
export default function TransitionProbe({ ctx }: PageProps<'/transition-probe'>) {
  const ms = Math.min(Number(ctx.url.searchParams.get('body') ?? 0) || 0, 10_000);
  return (
    <Layout title="Transition probe — rsvhono">
      <div className="page">
        <h1 data-probe-page={ms > 0 ? 'slow' : 'fast'} data-probe-visit={ctx.url.search}>
          Transition probe
        </h1>
        <a data-probe-go="slow" href="/transition-probe?body=3000">
          slow
        </a>{' '}
        <a data-probe-go="fast" href="/transition-probe?visit=fast">
          fast
        </a>{' '}
        {/* Fetched ahead on hover, focus or touch. See prefetch.spec.mjs. */}
        <a data-prefetch data-probe-go="prefetched" href="/users">
          users (prefetched)
        </a>{' '}
        <a data-prefetch data-probe-go="prefetched-redirect" href="/canonical">
          canonical (prefetched, redirects)
        </a>
        {/* Shows `router.pending`, which a fetch ahead must leave alone. */}
        <NavInfo />
        <TransitionProbePanel />
        {ms > 0 && <SlowBody ms={ms} />}
      </div>
    </Layout>
  );
}
