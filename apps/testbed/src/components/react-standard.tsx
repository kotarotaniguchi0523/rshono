import { cache, cacheSignal, Suspense } from 'react';
import type { PageProps } from '@rsvhono/core';
import { countLoad, swapRenderSignal } from '../react-standard-state';
import { Layout } from './layout';
import { BrowserOnly } from './react-standard-client';

/** React's own per-render memo: two components asking for the same thing in one render ask once. */
const loadGreeting = cache(async (name: string) => {
  const load = countLoad();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { name, load };
});

async function Greeting({ slot }: { slot: string }) {
  const greeting = await loadGreeting('world');
  return (
    <p data-greeting={slot} data-load={greeting.load}>
      hello {greeting.name}
    </p>
  );
}

/**
 * What React already provides, on this renderer: `cache()` across components of one render and not across
 * requests, `cacheSignal()` ending with the render, and `browser()` for a component the server leaves to the
 * browser. Nothing of the framework's is in between — the page is here so a test can say they work.
 */
export default function ReactStandard(_props: PageProps) {
  const current = cacheSignal() as AbortSignal | null;
  const before = swapRenderSignal(current);
  return (
    <Layout title="React standard APIs — rsvhono">
      <div className="page">
        <h1>React standard APIs</h1>
        <p
          data-previous-signal={before === null ? 'none' : before.aborted ? 'aborted' : 'live'}
          data-this-signal={current === null ? 'none' : 'given'}
        />
        <Greeting slot="one" />
        <Greeting slot="two" />
        <Suspense fallback={<p data-browser-only-fallback>waiting for the browser</p>}>
          <BrowserOnly />
        </Suspense>
      </div>
    </Layout>
  );
}
