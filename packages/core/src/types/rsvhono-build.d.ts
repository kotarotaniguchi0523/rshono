/**
 * The id of the build this code came out of, inlined into all three bundles — server, SSR and browser — by
 * `define`. One value per `rsvhono build`. Not defined at all under `rsvhono dev`, which has no builds to tell
 * apart; `runtime/build-id.ts` is the only reader and tests for that.
 */
declare const __RSVHONO_BUILD_ID__: string | undefined;
