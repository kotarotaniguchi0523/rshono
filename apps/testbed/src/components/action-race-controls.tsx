'use client';

import { startTransition, useEffect, useOptimistic, useState } from 'react';
import { like, recordRace, recordRaceAndRefresh, streamed } from '../actions';

declare global {
  interface Window {
    /** Calls `recordRace` and resolves with what it returned — the caller's half of the reply. */
    __race?: (label: string, delayMs: number) => Promise<string>;
    /** `recordRace` that also calls `requestRefresh()`. */
    __raceAndRefresh?: (label: string) => Promise<string>;
    /** Resolves with both halves of a streamed return value. */
    __streamed?: (label: string) => Promise<{ now: string; later: string }>;
  }
}

/**
 * Hands a browser test a way to call a server function directly, as many times at once as it likes. A form
 * with `useActionState` cannot do that: React queues its actions one after another.
 *
 * The like button is the one piece with a face: an optimistic count that shows at once and settles to what
 * the function returned, with nothing but the return value to settle it — it does not read the page.
 */
export function ActionRaceControls() {
  const [likes, setLikes] = useState(0);
  const [shown, addOptimistic] = useOptimistic(likes, (current: number, added: number) => current + added);

  useEffect(() => {
    window.__race = (label, delayMs) => recordRace(label, delayMs);
    window.__raceAndRefresh = (label) => recordRaceAndRefresh(label);
    window.__streamed = async (label) => {
      const value = await streamed(label);
      return { now: value.now, later: await value.later };
    };
    document.documentElement.dataset.actionRaceReady = 'true';
    return () => {
      delete window.__race;
      delete window.__raceAndRefresh;
      delete window.__streamed;
    };
  }, []);

  return (
    <button
      data-like
      data-settled={likes}
      onClick={() =>
        startTransition(async () => {
          addOptimistic(1);
          const total = await like();
          startTransition(() => setLikes(total));
        })
      }
    >
      Like ({shown})
    </button>
  );
}
