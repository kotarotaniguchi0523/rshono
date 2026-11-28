/**
 * The id of the build this code came out of. One value per `rsvhono build`, inlined into the two server
 * bundles by `define`; in the browser bundle the same name is defined as a read of the global the document
 * sets (`BUILD_GLOBAL` in `runtime/build-id.ts`), so the bundle's bytes do not change with the id. Not defined at all under `rsvhono dev`, which has no builds to tell
 * apart; `runtime/build-id.ts` is the only reader and tests for that.
 */
declare const __RSVHONO_BUILD_ID__: string | undefined;
