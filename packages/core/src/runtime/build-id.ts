// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/rsvhono-build.d.ts" />
/**
 * Which build this is, and how two halves of an app tell each other.
 *
 * A browser keeps the page it loaded for as long as the tab is open, and a deploy replaces the server under
 * it. From then on the two disagree about everything a build mints: which chunk a client component is in,
 * what a server function's id is, the key an inline function's closure was encrypted with. A flight payload
 * from the new server names chunks the old page cannot load; a call from the old page names a function the
 * new server does not have, or — worse — has, under the same id, with different code behind it.
 *
 * So every build has an id, the same one in the server bundle and the browser bundle, and it rides one
 * header: the server puts its own on every response, and the browser puts its own on a server function call.
 * Neither side reads a payload from the other before comparing.
 *
 * It says "built together" and nothing else. It is not a secret and not a check of who is calling.
 */

/** This bundle's build, or `undefined` under `rsvhono dev`, where there is nothing to compare. */
export const BUILD_ID: string | undefined = typeof __RSVHONO_BUILD_ID__ === 'string' ? __RSVHONO_BUILD_ID__ : undefined;

/** Carries a build id: on every response from the server, and on a server function call from the browser. */
export const BUILD_HEADER = 'x-rsvhono-build';

/** Whether `theirs` names a build, and it is not this one. An absent id is not a mismatch: nothing was claimed. */
export function isOtherBuild(theirs: string | null | undefined): boolean {
  return BUILD_ID !== undefined && typeof theirs === 'string' && theirs !== '' && theirs !== BUILD_ID;
}

/** What the browser throws when the server answering is not the build the page came from. */
export class BuildMismatchError extends Error {
  /** For a caller that wants to tell this from an ordinary failure without matching on the message. */
  readonly code = 'RSVHONO_BUILD_MISMATCH';
  constructor(readonly serverBuild: string) {
    super('[rsvhono] this page was built by a different deployment than the server that answered. Reload the page to get the current one.');
    this.name = 'BuildMismatchError';
  }
}
