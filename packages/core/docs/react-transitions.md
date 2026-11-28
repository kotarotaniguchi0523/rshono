# Navigations and a component's own transitions on React 19.3.1

What React does when a navigation and a client component's own state change are pending at the same time —
measured, and measured again under another framework to tell React's behaviour from this one's.

Nothing here is asserted by the test suite. It is an observation, taken with
`test/experiments/transition-probe.mjs` against `/transition-probe` in the testbed:

```bash
node test/experiments/transition-probe.mjs http://127.0.0.1:3000 [path to chrome]
```

## What was asked

`/transition-probe` carries one client component (`transition-probe-panel.tsx`) with four ways of changing
its own state, none of which knows about the router:

| Probe      | What it does                                                           |
| ---------- | ---------------------------------------------------------------------- |
| `sync`     | `startTransition(() => setState(…))`                                   |
| `async`    | `startTransition(async () => { await sleep(ms); startTransition(…) })` |
| `suspense` | a transition whose new state makes a child `use()` a 300 ms promise    |
| `action`   | a `useActionState` form whose server function takes `ms` to answer     |

`?body=3000` makes the page render an async server component _outside_ any `<Suspense>` for three seconds.
A navigation to it has its payload in hand at once — the URL has already committed — and the transition
rendering it is suspended. That is a navigation pending **inside React**, as opposed to one whose fetch is
still on the wire.

Two questions, both ways round:

1. With such a navigation pending, does each probe commit before the navigation does?
2. With a probe held pending for 2.5 s, does a navigation to a fast page commit before the probe finishes?

## What happened

React 19.3.1, Chrome, a production build. Times are from the click to the commit.

| Question                                          | rsvhono         | Waku 1.0.0-rc.5 router | waku-navigation 0.0.8 |
| ------------------------------------------------- | --------------- | ---------------------- | --------------------- |
| navigation pending → `sync` commits first         | 23 ms           | 22 ms                  | 23 ms                 |
| navigation pending → `async` commits first        | 306 ms          | 308 ms                 | 308 ms                |
| navigation pending → `suspense` commits first     | 328 ms          | 327 ms                 | 332 ms                |
| navigation pending → `action` commits first       | 327 ms          | 328 ms                 | 311 ms                |
| `async` pending 2.5 s → navigation commits first  | **no**, 2274 ms | **no**, 2276 ms        | **no**, 2269 ms       |
| `action` pending 2.5 s → navigation commits first | **no**, 2296 ms | **no**, 2295 ms        | **no**, 2258 ms       |

Every probe in the first four rows committed before the navigation did. In the last two the navigation
waited for the probe: the time is how long after the click it committed.

The Waku app was the same panel file, byte for byte, the same server function, and a page with the same
markup; it is not part of this repository. It was run twice: with Waku's own router and `<Link>`, and with
[`waku-navigation`](https://www.npmjs.com/package/waku-navigation) — the router built on the Navigation API,
which is the closer comparison — and plain anchors. Under rsvhono and under `waku-navigation` the URL had
already committed when the probe was clicked, which is what shows the navigation was pending in React and
not on the wire.

## What follows

- **An independent transition does not wait for a navigation.** A slow navigation does not freeze a
  component's own updates, its async transitions, a suspending transition or a `useActionState` action. This
  is case 16 of the client runtime's regression list; it holds, and it holds the same way under both Waku
  routers.
- **A navigation waits for an async transition or action that was already pending.** Its payload is fetched
  meanwhile, and it commits when the earlier one finishes. All three routers show it, within 40 ms of each
  other, so this
  is React — transitions started while an async action is in flight are entangled with it — and not
  something the navigation code here does.
- **Nothing was added to work around it.** No `flushSync`, no external store, no state kept beside React's
  to force the commit. A navigation delayed behind an action still reports `router.pending`, still fetches,
  and commits in order; an app that needs the navigation to win has to not start it from inside the action.
- Not measured: a navigation whose _fetch_ is still pending (there is no React transition yet, so there is
  nothing to entangle), two navigations against each other (the Navigation API aborts the older one before
  React is involved), and any browser but Chrome.
