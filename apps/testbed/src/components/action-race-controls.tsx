'use client';

import { startTransition, useEffect, useOptimistic, useState } from 'react';
import { failsLate, handBack, like, nested, recordRace, recordRaceAndRefresh, streamed, ticking } from '../actions';

declare global {
  interface Window {
    /** Calls `recordRace` and resolves with what it returned — the caller's half of the reply. */
    __race?: (label: string, delayMs: number) => Promise<string>;
    /** `recordRace` that also calls `requestRefresh()`. */
    __raceAndRefresh?: (label: string) => Promise<string>;
    /** Resolves with both halves of a streamed return value. */
    __streamed?: (label: string) => Promise<{ now: string; later: string }>;
    /** The newer return shapes, each resolved all the way down so a test can compare plain values. */
    __returns?: {
      ticking: (label: string, count: number, intervalMs: number) => Promise<number[]>;
      nested: (label: string) => Promise<string>;
      failsLate: (label: string) => Promise<{ now: string; later: string }>;
      handBack: () => Promise<{ sameFunction: boolean; sameInstance: boolean }>;
    };
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
    window.__returns = {
      ticking: async (label, count, intervalMs) => {
        const seen: number[] = [];
        for await (const n of await ticking(label, count, intervalMs)) seen.push(n);
        return seen;
      },
      nested: async (label) => (await (await (await nested(label)).a).b).c,
      failsLate: async (label) => {
        const value = await failsLate(label);
        // `await`, not `.catch()`: what flight hands back for a pending value is React's own thenable, whose
        // `then` settles the callbacks it is given and returns nothing to chain on.
        try {
          return { now: value.now, later: await value.later };
        } catch (error) {
          return { now: value.now, later: `rejected: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
      handBack: async () => {
        const fn = () => 'not serializable';
        const instance = new (class Local {})();
        const [a, b] = await Promise.all([handBack(fn), handBack(instance)]);
        return { sameFunction: a.same === fn, sameInstance: b.same === instance };
      },
    };
    document.documentElement.dataset.actionRaceReady = 'true';
    return () => {
      delete window.__race;
      delete window.__raceAndRefresh;
      delete window.__streamed;
      delete window.__returns;
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
