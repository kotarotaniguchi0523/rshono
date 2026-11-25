import type { PageProps } from '@rsvhono/core';
import { Layout } from './layout';
import { LazyLateClient } from './lazy-late-client';

/** A page whose client component imports one more chunk on a click. `?bounded=1` wraps it in an error boundary. */
export default function LazyLate({ url }: PageProps) {
  return (
    <Layout title="Lazy, late — rsvhono">
      <div className="page">
        <h1>Lazy, late</h1>
        <LazyLateClient bounded={url.searchParams.has('bounded')} />
      </div>
    </Layout>
  );
}
