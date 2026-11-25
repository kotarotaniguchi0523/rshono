import type { PageProps } from '@rsvhono/core';
import { raiseSignal } from '../actions';
import { raceLog } from '../race-log';
import { ActionRaceControls } from './action-race-controls';
import { Layout } from './layout';

/**
 * Server functions racing each other and racing navigations: the page lists what the server has applied, and
 * `window.__race(label, delayMs)` applies one more after a delay. Whatever order replies and re-reads arrive
 * in, the list on screen has to end up being the server's.
 */
export default function ActionRace(_props: PageProps) {
  return (
    <Layout title="Action race — rsvhono">
      <ActionRaceControls />
      <div className="page">
        <h1>Action race</h1>
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
