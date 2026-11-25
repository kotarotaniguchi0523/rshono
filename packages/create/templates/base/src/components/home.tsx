import type { PageProps } from '@rsvhono/core';
import { appName, Layout } from './layout';

export default function Home({ url }: PageProps<'/'>) {
  return (
    <Layout description="A new rsvhono app.">
      <h1>{appName}</h1>
      <p>
        Edit <code>src/components/home.tsx</code> and save — the page re-renders in place.
      </p>

      <h2>Where things are</h2>
      <ul>
        <li>
          <code>src/routes.ts</code> — the route table, the one file rsvhono requires
        </li>
        <li>
          <code>src/server.ts</code> — a Hono app for middleware and API routes, mounted ahead of the pages
        </li>
        <li>
          <code>src/components/</code> — pages and components
        </li>
        <li>
          <code>rsvhono.config.ts</code> — deploy target, security and build settings
        </li>
      </ul>

      <p>
        Rendered on the server for <code>{url.pathname}</code>.
      </p>
    </Layout>
  );
}
