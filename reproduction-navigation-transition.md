# Button-controlled navigation reproduction

Based on upstream main `532edf8e53b70f78c05a4385d4938c06de79965b` (@rshono/core 1.0.0-rc.24, React / React DOM 19.2.8).

The NavigationRepro component is exactly the code presented in the Issue draft. It creates an unresolved Promise when Navigate is clicked and resolves it only when Resolve is clicked. This branch changes only the testbed and test; framework runtime is unchanged.

```sh
pnpm install --frozen-lockfile
pnpm --filter @rshono/core build
pnpm --filter @rshono/core exec playwright install chromium
pnpm --filter @rshono/core exec playwright test navigation-transition.spec.mjs
```

The default test verifies the current buggy behavior. To run the assertions for correct Transition behavior on the same code, use:

```sh
RSHONO_EXPECT_TRANSITION=1 pnpm --filter @rshono/core exec playwright test navigation-transition.spec.mjs
```

That version fails on the unchanged runtime. It passes with only the following local change in loadPayload():

```diff
-    committed = setPayload(payload, afterCommit);
+    React.startTransition(() => {
+      committed = setPayload(payload, afterCommit);
+    });
```

Verified results before Resolve:

| Runtime | Initial content visible | Loading visible | router.pending |
| --- | --- | --- | --- |
| Unmodified upstream | false | true | false |
| Nested startTransition | true | false | true |

Both runs: after Resolve, Activity content is visible, pending is false, the document marker is preserved, and pageerror events are empty. The fix is not included in this branch.

Commands executed in verification:

- Unmodified: `pnpm --filter @rshono/core build && pnpm --filter @rshono/core exec playwright test navigation-transition.spec.mjs` -> 1 passed (observes the bug)
- With the local fix: `pnpm --filter @rshono/core build && RSHONO_EXPECT_TRANSITION=1 pnpm --filter @rshono/core exec playwright test navigation-transition.spec.mjs` -> 1 passed (correct behavior)

Linux x86_64, Node v24.19.0, pnpm 11.25.0, Chromium 153.0.8010.0. The standard Playwright Chromium download failed in this environment. A Chromium binary provided by @sparticuz/chromium was used through a temporary local launchOptions override; the override is not included in this branch.
