/**
 * The few moments of a navigation that only this runtime knows, put where the browser's Performance panel
 * already shows the rest.
 *
 * React draws its own tracks — scheduler, components, server components — and the Navigation API's timing
 * is the browser's. What neither can see is the seam between them: when a payload's root arrived, when its
 * stream ended, how long a render waited between being handed to React and committing. Those are measured
 * here with `performance.measure`, tagged the way Chrome's extensibility API reads, as one more track beside
 * React's.
 *
 * Development only. `process.env.NODE_ENV` is a literal in the browser bundle, so in a production build the
 * condition is constant and all of this is dropped — there is no flag to leave on by accident.
 */
const on = process.env.NODE_ENV !== 'production' && typeof performance !== 'undefined';

/** A timestamp to measure from, or `0` where nothing is measured. */
export const started = (): number => (on ? performance.now() : 0);

/** Records the span from `start` to now on the framework's track. */
export function measure(name: string, start: number): void {
  if (!on) return;
  try {
    performance.measure(name, {
      start,
      end: performance.now(),
      detail: { devtools: { dataType: 'track-entry', track: 'rsvhono', color: 'tertiary' } },
    });
  } catch {
    // An out-of-range mark, or a browser without the options form. Timing is never worth an error.
  }
}
