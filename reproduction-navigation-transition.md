# Navigation Transition reproduction

Based on upstream main `532edf8e53b70f78c05a4385d4938c06de79965b` (@rshono/core 1.0.0-rc.24, React / React DOM 19.2.8).

This branch changes only the testbed and adds a browser test. The framework runtime is unchanged.

```sh
pnpm install --frozen-lockfile
pnpm --filter @rshono/core build
pnpm --filter @rshono/core exec playwright install chromium
pnpm --filter @rshono/core exec playwright test navigation-transition.spec.mjs
```

The test navigates `/profile/1` to `?tab=activity`. The destination reads a client resource inside an already revealed Suspense boundary. Playwright holds that resource response until explicitly released, so suspension is controlled rather than timer-based. Its request proves the destination payload reached rendering.

Expected: Initial content remains visible and router.pending stays true until the held resource is released. Actual on the unchanged runtime: Initial content is hidden, Loading client content is displayed, and pending reads no. The visibility assertion fails.

A local experiment wrapping the post-await `setPayload(payload, afterCommit)` call in `React.startTransition` makes this test pass, without awaiting the DOM commit inside the outer async Action. That experiment is deliberately not included in this reproduction branch.

Verified with Node v24.19.0, pnpm 11.25.0, Chromium 153.0.8010.0 on Linux.
