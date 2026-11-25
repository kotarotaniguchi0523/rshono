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
- **`navigation.finished` resolves only when its own destination committed.** A navigation that lost the
  screen rejects with an `AbortError`, and one whose render failed rejects with the error — the document load
  that recovers it is a new navigation.
- **Everything an action reply does to the screen passes one test**: no navigation has been asked for since
  the call (`navigationIntent()`), and none is under way. That covers the re-rendered page, a `redirect()` and
  a `notFound()` alike. A reply that fails the test changes nothing — it does not cancel the navigation
  either — and the page the visitor ends up on is re-read once that navigation is through, because it may
  have been rendered before the mutation. The return value or error reaches the caller regardless.
- **Two actions in flight together end in one re-read of the page.** The order calls were made in is not the
  order the server applied them in, so neither reply is trusted to be the newer snapshot.
- **A re-read is finished when its payload has committed, not when its fetch starts.** `revalidate()` counts
  the reasons to re-read (`stale`) against what the screen has caught up with (`fresh`) and goes round until
  they agree. A re-read that loses the screen to a navigation waits for it and reads the destination; one
  that was fetched before a later mutation's reply arrived is thrown away unshown and made again; and it
  asks with `cache: 'no-store'`, because a prerendered payload is served `max-age=300`.
- **Navigations carry a React transition type**: `navigation-push`, `-replace`, `-reload`, `-back`,
  `-forward`, decided at dispatch. A `<ViewTransition>` can key its direction on them.
- **No Navigation API, no hydration.** The runtime has no other way to navigate, so where the API is missing
  the document stays as the server rendered it. One check, in `entry.client.tsx`; the `location.*` fallbacks
  are gone. `NavigationPrecommitController` is still feature-detected: Safari ships the API without it, and
  that is a current browser, not an old one.

## Things found on the way

- **React 19.3 starts navigations of its own.** With a transition pending and none under way it calls
  `navigation.navigate(currentUrl, { info: 'react-transition', history: 'replace' })` so the browser shows a
  loading indicator. The old listener answered those as a `replace`: it re-fetched the page. They are
  ignored now.
- **Two transitions for one address change.** A traversal fires `currententrychange` and then `popstate`.
  Starting a transition for each was observed, on 19.3.1, to commit the first with its Suspense fallbacks
  showing. The address follower now listens to `currententrychange` alone, which every change of entry fires.
- **A pending action holds a navigation's commit.** With an async transition or a `useActionState` action
  in flight, a navigation started meanwhile fetches its payload but does not commit until the earlier one
  finishes. The other way round nothing waits: a component's own transitions commit while a navigation is
  suspended. Both were measured, and measured the same under Waku — it is React's entanglement of
  transitions with an async action, not this runtime's. [`react-transitions.md`](react-transitions.md) has
  the numbers.
- **`reapplyPayload`** worked around React not retrying a transition after a late flight chunk. With it
  removed the suite passes on 19.3.1, including the case written for it (`navigation-address.spec.mjs`,
  "URL-selected Suspense resolves without … a stuck pending state"). That is evidence it is unnecessary
  here, not a proof about React.
- **A disconnect during the error page's render** was logged as a failure whenever the abort landed in the
  RSC half of that render. Fixed on the server (`entry.rsc.tsx`); it is what had blocked the React bump.

## The design's regression list, honestly

The design named 22 cases. Browser suite: 105 pass.

| #      | Case                                                             | Status                                                                                                              |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1      | no double fetch between precommit and render                     | **tested** (`navigation-resource.spec.mjs`)                                                                         |
| 2      | one `AbortController` per fetch                                  | by construction; not asserted                                                                                       |
| 3, 4   | streaming continues after the root, and after commit             | existing streaming and precommit cases                                                                              |
| 5      | the page on screen is not aborted when a navigation starts       | by construction; not separately asserted                                                                            |
| 6      | an unapplied fetch is aborted promptly                           | existing cancellation cases; the abort itself is not asserted                                                       |
| 7      | an old navigation does not overwrite a newer page                | existing (`navigation-action.spec.mjs`, lifecycle cases)                                                            |
| 8      | A → B → A distinguishes old work                                 | **tested** (`navigation-revalidation.spec.mjs`): the old reply changes nothing and its caller gets the result       |
| 9      | `finished` does not succeed during a pending commit              | **tested** — prepared payloads (existing) and traversals (new)                                                      |
| 10     | restoring the same resource commits anew                         | exercised by "Back abandons suspension"; the notification is not asserted                                           |
| 11     | a superseded attempt is not a success                            | router calls and `navigation.finished` both reject; asserted for the router, not for every `finished` path          |
| 12     | a failed render does not leave waiters hanging                   | **tested** ("a prepared payload whose render fails rejects …")                                                      |
| 13     | no listeners left after a failed or aborted stream               | by construction (`begin()` removes its abort listener when it ends); **not tested**                                 |
| 14     | a discarded action payload keeps its return value                | **tested** — the A → B → A case and the order-inversion case both read the caller's result                          |
| 15     | racing actions and navigations do not go back to an old snapshot | **tested**: action vs navigation, a stale redirect, action vs action in reverse order, a mutation during a re-read  |
| 16     | a slow navigation does not block an independent transition       | measured, not asserted — see `react-transitions.md`                                                                 |
| 17, 18 | SSR / hydration agree; static pages read URL, query, hash        | existing (`navigation-address.spec.mjs`)                                                                            |
| 19     | Back, Forward, redirect, scroll, focus                           | existing suite                                                                                                      |
| 20     | HMR goes through the same model                                  | `test/hmr.test.mjs` (server edit and client edit, state kept)                                                       |
| 21     | the streaming retry workaround is unnecessary                    | removed; suite passes — see above                                                                                   |
| 22     | the existing suite passes                                        | yes, with two cases changed on purpose: `finished` on traversal, and which line reports a corrupt bootstrap payload |

Not adopted from the design, and why: `hydrateRoot` inside a transition, `ViewTransition`, `useOptimistic`
for pending — none was needed to make anything above work, and each is a behaviour change of its own.

## Reviewed and left as it is

- **CSP nonce on client-reference preloads.** `@vitejs/plugin-rsc` 0.5.39 — the newest release — calls
  `ReactDOM.preloadModule` / `preinit` for a client reference's dependencies with no nonce and no hook to add
  one (`setResourceOptionsCallback` is not in it). Nothing here can supply it until a release has that API.
- **The page wrapper (`rsvhono:pages`).** Still needed: the plugin's own CSS wrapper re-creates the element
  with `createElement(Page, props)` and drops the non-enumerable `ctx`. Removing it needs that changed
  upstream, or `ctx` delivered another way.
- **`env-shadow`.** No Vite setting isolates `process.env` in the SSR environment; `define` replaces one
  spelling of the read out of six. A module that declares its own `process` still fails the build rather
  than shipping.
- **The dev request path** (`serverHandler: false`), **`prerender()` for SSG** and **rendering the router
  context straight from the server component** were not tried.
- **Which resources `retire` keeps** — the committed attempt's and the newest scheduled one's — has not been
  checked against several transitions rendering at once.
