'use client';

import { useEffect } from 'react';
import { recordRace } from '../actions';

declare global {
  interface Window {
    /** Calls `recordRace` and resolves with what it returned — the caller's half of the reply. */
    __race?: (label: string, delayMs: number) => Promise<string>;
  }
}

/**
 * Hands a browser test a way to call a server function directly, as many times at once as it likes. A form
 * with `useActionState` cannot do that: React queues its actions one after another.
 */
export function ActionRaceControls() {
  useEffect(() => {
    window.__race = (label, delayMs) => recordRace(label, delayMs);
    document.documentElement.dataset.actionRaceReady = 'true';
    return () => {
      delete window.__race;
    };
  }, []);
  return null;
}
