import type { PageProps } from '@rsvhono/core';
import { reachDirect } from '../reach/direct';
import { Layout } from './layout';
import { ReachabilityClient } from './reachability-client';

/**
 * A page that reaches server functions by every edge the module graph has — a direct reference from a server
 * component, a re-export, a client component loaded lazily, and a server component loaded with `import()` —
 * each in a module of its own, so the route-functions manifest can be checked function by function. Nothing
 * a visitor needs.
 */
/** Used by the server component below and never passed to a client one: it has no business in the browser bundle. */
const SERVER_COMPONENT_ONLY = '__server_component_only__';

export default async function Reachability(_props: PageProps) {
  const { ReachabilityLazyServer } = await import('./reachability-lazy-server');
  return (
    <Layout title="Reachability — rsvhono">
      <div className="page">
        <h1 data-length={SERVER_COMPONENT_ONLY.length}>Reachability</h1>
        <form action={reachDirect} data-reach="direct">
          <button type="submit">direct</button>
        </form>
        <ReachabilityClient />
        <ReachabilityLazyServer />
      </div>
    </Layout>
  );
}
