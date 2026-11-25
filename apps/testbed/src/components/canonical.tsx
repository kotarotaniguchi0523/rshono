import type { PageProps } from '@rsvhono/core';
import { redirect } from '@rsvhono/core/server';
import { Layout } from './layout';

/**
 * `/canonical` redirects to itself with `?v=new` — the same path, a different query. A router that compares
 * paths to decide whether anything changed would call that a no-op, or a loop.
 */
export default function Canonical({ url }: PageProps) {
  const version = url.searchParams.get('v');
  if (version !== 'new') redirect('/canonical?v=new');
  return (
    <Layout title="Canonical — rsvhono">
      <div className="page">
        <h1 data-canonical>Canonical {version}</h1>
      </div>
    </Layout>
  );
}
