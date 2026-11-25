import { defineRoutes } from '@rsvhono/core';

export const routes = defineRoutes({
  routes: [
    {
      path: '/',
      component: () => import('./components/home'),
    },
    {
      path: '/signup',
      component: () => import('./components/signup'),
    },
    {
      // A form a server component renders, posted as a single `$ACTION_ID_` field — the no-`useActionState`
      // shape, which nothing else in this app exercises. See `subscribe` in src/actions.ts.
      path: '/subscribe',
      component: () => import('./components/subscribe'),
    },
    {
      path: '/crash',
      component: () => import('./components/crash'),
    },
    {
      path: '/login',
      component: () => import('./components/login'),
    },
    {
      path: '/dashboard',
      component: () => import('./components/dashboard'),
    },
    {
      path: '/docs/:slug',
      render: 'static',
      component: () => import('./components/documentation'),
      staticPaths: async () => {
        const { fakeDB } = await import('./db');
        return (await fakeDB.listDocs()).map((doc) => ({ slug: doc.slug }));
      },
    },
    {
      path: '/profile/:id',
      component: () => import('./components/profile'),
    },
    {
      path: '/navigation-async-boundary',
      component: () => import('./components/navigation-async-boundary'),
    },
    {
      path: '/navigation-async-other',
      component: () => import('./components/navigation-async-boundary'),
    },
    {
      path: '/navigation-async-propagate',
      component: () => import('./components/navigation-async-propagate'),
    },
    {
      path: '/navigation-async-nested',
      component: () => import('./components/navigation-async-nested'),
    },
    {
      path: '/navigation-address-suspense',
      component: () => import('./components/navigation-address-suspense'),
    },
    {
      path: '/navigation-suspense',
      component: () => import('./components/navigation-suspense'),
    },
    {
      // Soft navigation between two pages whose `AsyncBoundary` child resolves only after the shell — the
      // only shape that suspends a streamed navigation payload. See streamed-boundary.tsx.
      path: '/streamed-boundary-a',
      component: () => import('./components/streamed-boundary-a'),
    },
    {
      path: '/streamed-boundary-b',
      component: () => import('./components/streamed-boundary-b'),
    },
    {
      // Its response head is delayed by testbed middleware, so a navigation to it can be cancelled before its
      // payload reaches React. See src/server.ts and the cancelled-navigation tests in
      // navigation-transition.spec.mjs.
      path: '/slow-shell',
      component: () => import('./components/slow-shell'),
    },
    {
      path: '/slow-shell-source',
      component: () => import('./components/slow-shell-source'),
    },
    {
      // Shell first, content after a two-second suspension: a response that is still open when a server
      // rebuild lands. See the worker-drain test in dev.test.mjs.
      path: '/slow-stream',
      component: () => import('./components/slow-stream'),
    },
    {
      // Its fragment target is inside a slow boundary, so a soft `#hash` navigation has to wait for the
      // stream. See the streamed-anchor test in client-runtime.spec.mjs.
      path: '/anchor-stream',
      component: () => import('./components/anchor-stream'),
    },
    {
      path: '/users',
      component: () => import('./components/user-list'),
    },
    {
      path: '/mount-navigation',
      component: () => import('./components/mount-navigation'),
    },
    {
      // Overlapping server functions, and server functions against navigations. See navigation-revalidation.spec.mjs.
      path: '/action-race',
      component: () => import('./components/action-race'),
    },
    {
      // A server function declared inside a component, with an encrypted closure. See prod.test.mjs.
      path: '/inline-action',
      component: () => import('./components/inline-action'),
    },
    {
      // What a client component's own transitions do while a navigation is pending, and the reverse. Read by
      // packages/core/test/experiments/transition-probe.mjs — an observation, not a test.
      path: '/transition-probe',
      component: () => import('./components/transition-probe'),
    },
    {
      path: '/whoami',
      component: () => import('./components/whoami'),
    },
    {
      path: '/suspense-redirect',
      component: () => import('./components/suspense-redirect'),
    },
    {
      path: '/boundary',
      component: () => import('./components/boundary-demo'),
    },
    {
      path: '/late-signal',
      component: () => import('./components/late-signal'),
    },
    {
      // Deliberately broken, and linked from nowhere: its module throws as it evaluates. See the component.
      path: '/unloadable',
      component: () => import('./components/unloadable'),
    },
    {
      // Reaches server functions through a re-export and two kinds of `import()`. See the route-functions manifest.
      path: '/reachability',
      component: () => import('./components/reachability'),
    },
    {
      // An experiment: a fragment rendered to flight once and replayed, server function and all.
      path: '/flight-replay',
      component: () => import('./components/flight-replay'),
    },
    {
      // React's own `cache()`, `cacheSignal()` and `browser()` on this renderer.
      path: '/react-standard',
      component: () => import('./components/react-standard'),
    },
    {
      // Imports a chunk on a click, long after hydration. See chunk-recovery.spec.mjs.
      path: '/lazy-late',
      component: () => import('./components/lazy-late'),
    },
    {
      // Redirects that add, change or drop the fragment. See navigation-redirects.spec.mjs.
      path: '/fragment-redirect/:step',
      component: () => import('./components/fragment-redirect'),
    },
    {
      // Redirects to its own path with a different query. See navigation-redirects.spec.mjs.
      path: '/canonical',
      component: () => import('./components/canonical'),
    },
    {
      // A late `redirect()` or `notFound()` the test triggers, from a page that may no longer be the one the
      // visitor is going to. See navigation-intent.spec.mjs.
      path: '/gated-intent',
      component: () => import('./components/gated-intent'),
    },
    {
      type: 'endpoint',
      path: '/api/gate',
      method: 'post',
      server: () => import('./gate'),
    },
    {
      type: 'endpoint',
      path: '/api/quick-health',
      // `'get'` and not `'head'`, which the union no longer offers: Hono dispatches a HEAD as a GET, so
      // this one registration answers both — and a HEAD-only route would answer neither.
      method: 'get',
      server: () => import('./health'),
    },
    {
      type: 'endpoint',
      path: '/api/preflight',
      // The one method a page route never answers and a cross-origin action needs answered: a CORS
      // preflight is an OPTIONS.
      method: 'options',
      server: () => import('./preflight'),
    },
    {
      type: 'endpoint',
      path: '/api/session',
      // Two methods, one handler. The alternative is `'all'` plus a hand-rolled check, which would also
      // answer every method nobody asked it to.
      method: ['get', 'delete'],
      server: () => import('./session'),
    },
    {
      type: 'endpoint',
      // A cross-site form post — the arrival shape of SAML ACS, OIDC `response_mode=form_post` and most
      // payment-gateway returns. A page route refuses every one of those, before the body is read, because
      // a form post to a page is how a server action is called. An endpoint is the documented way to take
      // one: it calls its handler directly and never reaches the page renderer.
      path: '/api/acs',
      method: 'post',
      server: () => import('./acs'),
    },
    {
      type: 'endpoint',
      path: '/api/boom',
      server: () => import('./boom'),
    },
  ],
  notFound: {
    component: () => import('./components/404'),
  },
  error: {
    component: () => import('./components/500'),
  },
});
