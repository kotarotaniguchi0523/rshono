import type { ReactNode } from 'react';
import { createFromReadableStream, renderToReadableStream } from '@vitejs/plugin-rsc/rsc';
import type { PageProps } from '@rsvhono/core';
import { reachDirect } from '../reach/direct';
import { Layout } from './layout';

/** The fragment's flight, as rendered once. Process memory: this is an experiment, not a cache. */
let stored: Uint8Array[] | undefined;
const renders = { count: 0 };
const countRender = (): number => ++renders.count;

/** Rendered once and replayed after that — with a server function in it, which is the hard part. */
function Fragment() {
  return (
    <section data-replay-renders={countRender()}>
      <p>Rendered once, replayed from stored flight.</p>
      <form action={reachDirect} data-replay-form>
        <button type="submit">submit</button>
      </form>
    </section>
  );
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

const replay = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

/**
 * An experiment with `@vitejs/plugin-rsc`'s flight replay, after its `cache-replay` example: a fragment is
 * rendered to flight once, kept, and decoded back into a tree on later requests instead of being rendered
 * again. `preserveServerReferences` is what lets the stored flight carry a `<form action={serverFunction}>`:
 * the function stays a reference through the decode and is written out as one again, instead of being
 * loaded and failing to serialize.
 *
 * Not a framework feature. It is here to show the pieces fit on this renderer, and what a cache built on
 * them would have to add: a key, invalidation, the build id, and something better than a module variable.
 */
export default async function FlightReplay(_props: PageProps) {
  stored ??= await collect(renderToReadableStream(<Fragment />));
  const fragment = await createFromReadableStream<ReactNode>(replay(stored), {}, { preserveServerReferences: true });
  return (
    <Layout title="Flight replay — rsvhono">
      <div className="page">
        <h1>Flight replay</h1>
        {fragment}
      </div>
    </Layout>
  );
}
