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

| Question                                          | rsvhono                 | Waku 1.0.0-rc.5         |
| ------------------------------------------------- | ----------------------- | ----------------------- |
| navigation pending → `sync` commits first         | yes, 23 ms              | yes, 22 ms              |
| navigation pending → `async` commits first        | yes, 306 ms             | yes, 308 ms             |
| navigation pending → `suspense` commits first     | yes, 328 ms             | yes, 327 ms             |
| navigation pending → `action` commits first       | yes, 327 ms             | yes, 328 ms             |
| `async` pending 2.5 s → navigation commits first  | **no** — waits, 2274 ms | **no** — waits, 2276 ms |
| `action` pending 2.5 s → navigation commits first | **no** — waits, 2296 ms | **no** — waits, 2295 ms |

The Waku app was the same panel file, byte for byte, the same server function, and a page with the same
markup using Waku's `<Link>`; it is not part of this repository.

## What follows

- **An independent transition does not wait for a navigation.** A slow navigation does not freeze a
  component's own updates, its async transitions, a suspending transition or a `useActionState` action. This
  is case 16 of the client runtime's regression list; it holds, and it holds the same way under Waku.
- **A navigation waits for an async transition or action that was already pending.** Its payload is fetched
  meanwhile, and it commits when the earlier one finishes. The timings match Waku's to within 2 ms, so this
  is React — transitions started while an async action is in flight are entangled with it — and not
  something the navigation code here does.
- **Nothing was added to work around it.** No `flushSync`, no external store, no state kept beside React's
  to force the commit. A navigation delayed behind an action still reports `router.pending`, still fetches,
  and commits in order; an app that needs the navigation to win has to not start it from inside the action.
- Not measured: a navigation whose _fetch_ is still pending (there is no React transition yet, so there is
  nothing to entangle), two navigations against each other (the Navigation API aborts the older one before
  React is involved), and any browser but Chrome.
