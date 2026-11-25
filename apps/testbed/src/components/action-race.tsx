import type { PageProps } from '@rsvhono/core';
import { notFound, redirect } from '@rsvhono/core/server';
import { raiseSignal } from '../actions';
import { countRaceRender, raceLog } from '../race-log';
import { ActionRaceControls } from './action-race-controls';
import { Layout } from './layout';

/**
 * Server functions racing each other and racing navigations: the page lists what the server has applied, and
 * `window.__race(label, delayMs)` applies one more after a delay. Whatever order replies and re-reads arrive
 * in, the list on screen has to end up being the server's.
 */
export default function ActionRace({ url }: PageProps) {
  const renders = countRaceRender();
  // `?after=<label>&then=redirect|notfound`: once the server has applied that label, the page no longer
  // renders — it sends the visitor away, or stops existing. So an action that applies it *succeeds*, and it is
  // the render after it that ends in a route intent.
  const after = url.searchParams.get('after');
  if (after && raceLog.includes(after)) {
    if (url.searchParams.get('then') === 'notfound') notFound();
    redirect('/users');
  }
  return (
    <Layout title="Action race — rsvhono">
      <ActionRaceControls />
      <div className="page">
        <h1>Action race</h1>
        <p data-race-renders>{renders}</p>
        <ul data-race-log>
          {raceLog.map((label, index) => (
            <li key={index} data-race-entry={label}>
              {label}
            </li>
          ))}
        </ul>
        {/* A server-rendered form, so it posts without JavaScript too: `to` empty asks for `notFound()`. */}
        <form action={raiseSignal} data-raise-signal>
          <input name="to" placeholder="redirect to — empty for notFound()" />
          <button type="submit">Raise</button>
        </form>
        <h2 id="details">Details</h2>
      </div>
    </Layout>
  );
}
