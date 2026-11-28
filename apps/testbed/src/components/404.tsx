import type { PageProps } from '@rsvhono/core';
import { notFound, redirect } from '@rsvhono/core/server';
import { raceLog } from '../race-log';
import { ActionRaceControls } from './action-race-controls';
import { Layout } from './layout';

export default function NotFound({ url }: PageProps) {
  // A 404 page that fails on demand, which nothing links to: `?boom=notfound` throws the very signal that
  // brought it here, and `?boom=redirect` sends the visitor somewhere else. The first is the re-entry that
  // used to escape the framework's error handler as a bodiless, unlogged 500; the second is a real pattern
  // — "no such profile, go to the list" — that has to keep working from both places a 404 is rendered.
  const boom = url.searchParams.get('boom');
  if (boom === 'notfound') notFound();
  if (boom === 'redirect') redirect('/users');

  return (
    <Layout title="404 — rsvhono">
      <div className="page">
        {/* An action can be called from here too, and has to re-render *this* page: see `window.__race`. */}
        <ActionRaceControls />
        <h1>404 — nothing here</h1>
        <p data-not-found-count>{raceLog.length}</p>
        <p className="description">
          No page at <code>{url.pathname}</code>. <a href="/">Back to the start</a>.
        </p>
      </div>
    </Layout>
  );
}
