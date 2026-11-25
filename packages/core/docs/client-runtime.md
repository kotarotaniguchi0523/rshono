# The client runtime

How the browser side is put together after its redesign: what the pieces are, what each one replaced, and
which of the design's regression cases are actually under test.

It runs on React 19.3.1 and the Navigation API. `src/runtime/entry.client.tsx` is the bootstrap; the rest is
in `src/runtime/browser/`.

| Module                     | Holds                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `page-resource.ts`         | a flight payload being read: the fetch, its root, its one `AbortController`, and who holds it |
| `render-attempt.ts`        | one request to show a payload, and whether React committed it                                 |
| `root.tsx`                 | the React state — one object: the attempt and the address it is rendered at                   |
| `navigation.ts`            | the `navigate` listener: precommit, redirects, traversal, router calls, what `finished` means |
| `server-function.ts`       | action calls: the return value, and whether the reply's page may be shown                     |
| `document.ts`, `scroll.ts` | leaving for a new document and the failure panels; scroll and focus (moved, not rewritten)    |

## The two objects

**`PageResource`** is made when a read starts and is the same object until it is let go: through the
precommit phase, into the render that shows it, for as long as that render is on screen. One fetch, one
controller, one root promise. Its stream is wrapped once so that how it ended — completed, aborted, failed —
is observable without `tee()`. The document's inlined payload is a resource too, with an inert controller.

Who may stop a resource depends on who holds it. _Prepared_ (being fetched, React has not seen it): stopped
the moment its navigation is cancelled or replaced. _Held_ (handed to React): stopped only when a different
render has committed and it belongs neither to that render nor to the next — because a payload's root
resolves long before its stream ends, and aborting a stream React is still reading rejects chunks into the
tree on screen.

**`RenderAttempt`** is one showing of a resource. It is the React state itself, so "which attempt committed"
is the identity of the object the layout effect receives. Its `completion` settles once, as `committed`,
`superseded` or `failed`; showing the same resource again (Back onto the page still on screen, while a later
one was suspended) is a new attempt with its own outcome.

## What replaced what

| Was                                                                                   | Is                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `FetchedPayload`, `PreparedNavigation`                                                | `PageResource`                                                                 |
| `NavigationFetch`, `navigationFetches`, `navigationModels`                            | the prepared / held sets in `page-resource.ts`                                 |
| a second `AbortController` per navigation, and abort forwarding between the two       | the resource's own                                                             |
| `renders` WeakMap, `revision`, `currentPayload`                                       | the attempt is the state                                                       |
| `renderedModel`, `renderedUrl`, `pendingRender`                                       | `committedAttempt()`, `pendingAttempt()`                                       |
| `currentNavigation` generation counter                                                | a resource is stale when its controller is aborted; an attempt when superseded |
| `navigation-preparation.ts`'s store and `useSyncExternalStore`                        | a callback into root state                                                     |
| `navigation-transition.ts`: `networkPending`, the request set, the `popstate` restore | gone — `pending` is "a prepared resource exists" or the root's transition      |
| per-hook address state and listeners in `useNavigation`                               | one address in root state, read through context                                |
| `popstate` handling of Back / Forward, `traversalAttempt`                             | the traversal is intercepted like any navigation                               |
| `reapplyPayload` (re-dispatch after the stream settles)                               | removed — see below                                                            |

Client runtime source went from 1,763 lines (`entry.client.tsx`, `navigation-preparation.ts`,
`navigation-transition.ts`) to 1,570 across the files above. The count was not the aim and is not much of a
result; the table is.

## Behaviour that changed

- **`navigation.finished` waits for a traversal's payload to commit.** A Back or Forward used to be answered
  from `popstate`, after the browser had already reported the navigation finished.
- **A component that suspends on `useNavigation().url` holds the navigation.** The address used to change in
  a transition of its own. Under React 19.3's independent transitions that let the payload commit — and
  `router.pending` clear, and `finished` resolve — with the page still suspended. The address and the
  attempt are now one state.
- **A superseded navigation's handler returns only after whatever replaced it has committed.**
- **A server action's page payload is shown only on the visit that called it** — same document, same history
  entry, and no other page shown in between — and never over a newer action's. The return value or error
  reaches the caller regardless.

Not changed: below the Navigation API the router still falls back to document navigations, in about ten
lines. Removing that was considered and is not worth a broken `router.push()` on a browser without the API.

## Things found on the way

- **React 19.3 starts navigations of its own.** With a transition pending and none under way it calls
  `navigation.navigate(currentUrl, { info: 'react-transition', history: 'replace' })` so the browser shows a
  loading indicator. The old listener answered those as a `replace`: it re-fetched the page. They are
  ignored now.
- **Two transitions for one address change.** A traversal fires `currententrychange` and then `popstate`.
  Starting a transition for each was observed, on 19.3.1, to commit the first with its Suspense fallbacks
  showing. The address follower drops the repeat. _Why_ React does that was not investigated.
- **`reapplyPayload`** worked around React not retrying a transition after a late flight chunk. With it
  removed the suite passes on 19.3.1, including the case written for it (`navigation-address.spec.mjs`,
  "URL-selected Suspense resolves without … a stuck pending state"). That is evidence it is unnecessary
  here, not a proof about React.
- **A disconnect during the error page's render** was logged as a failure whenever the abort landed in the
  RSC half of that render. Fixed on the server (`entry.rsc.tsx`); it is what had blocked the React bump.

## The design's regression list, honestly

The design named 22 cases. Browser suite: 98 pass (95 that existed, two of them re-pointed, plus three new).

| #      | Case                                                             | Status                                                                                                              |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1      | no double fetch between precommit and render                     | **tested** (`navigation-resource.spec.mjs`)                                                                         |
| 2      | one `AbortController` per fetch                                  | by construction; not asserted                                                                                       |
| 3, 4   | streaming continues after the root, and after commit             | existing streaming and precommit cases                                                                              |
| 5      | the page on screen is not aborted when a navigation starts       | by construction; not separately asserted                                                                            |
| 6      | an unapplied fetch is aborted promptly                           | existing cancellation cases; the abort itself is not asserted                                                       |
| 7      | an old navigation does not overwrite a newer page                | existing (`navigation-action.spec.mjs`, lifecycle cases)                                                            |
| 8      | A → B → A distinguishes old work                                 | implemented (history entry + visit count); **not tested**                                                           |
| 9      | `finished` does not succeed during a pending commit              | **tested** — prepared payloads (existing) and traversals (new)                                                      |
| 10     | restoring the same resource commits anew                         | exercised by "Back abandons suspension"; the notification is not asserted                                           |
| 11     | a superseded attempt is not a success                            | router calls reject with `AbortError`; not asserted for every path                                                  |
| 12     | a failed render does not leave waiters hanging                   | existing ("a prepared payload whose render fails settles …")                                                        |
| 13     | no listeners left after a failed or aborted stream               | by construction; **not tested**                                                                                     |
| 14     | a discarded action payload keeps its return value                | page-not-repainted is **tested**; the return value reaching the caller is not                                       |
| 15     | racing actions and navigations do not go back to an old snapshot | existing snapshot case; action-versus-action ordering **not tested**                                                |
| 16     | a slow navigation does not block an independent transition       | **not tested**                                                                                                      |
| 17, 18 | SSR / hydration agree; static pages read URL, query, hash        | existing (`navigation-address.spec.mjs`)                                                                            |
| 19     | Back, Forward, redirect, scroll, focus                           | existing suite                                                                                                      |
| 20     | HMR goes through the same model                                  | `test/hmr.test.mjs` (server edit and client edit, state kept)                                                       |
| 21     | the streaming retry workaround is unnecessary                    | removed; suite passes — see above                                                                                   |
| 22     | the existing suite passes                                        | yes, with two cases changed on purpose: `finished` on traversal, and which line reports a corrupt bootstrap payload |

Not adopted from the design, and why: `hydrateRoot` inside a transition, `ViewTransition`,
`addTransitionType`, `useOptimistic` for pending — none was needed to make anything above work, and each is
a behaviour change of its own.
