/**
 * What `/action-race` shows: the labels `recordRace` has applied, in the order the *server* applied them.
 * Process memory on purpose — the page exists to make that order visible to a browser test.
 */
export const raceLog: string[] = [];

/** How many times `/action-race` has been rendered — what a test reads to see that a call did *not* render it. */
const raceRenders = { count: 0 };

/** Counts one render of `/action-race` and returns the total. A function, so the page mutates nothing itself. */
export const countRaceRender = (): number => ++raceRenders.count;

/** What `like()` counts. */
export const likes = { count: 0 };
