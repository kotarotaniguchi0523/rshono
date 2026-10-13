'use client';

import { createContext, startTransition, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

/** Outcome of a router action: a committed page, an unavailable history entry, or a browser load. */
export type NavigationOutcome = { kind: 'rendered'; url: URL } | { kind: 'no-op' } | { kind: 'document-navigation' };

/**
 * Imperative navigation actions, reached as `useNavigation().router`.
 *
 * When intercepted, actions fetch and apply the page's flight payload in place, so
 * client component state outside the changed subtree survives. Off-site hrefs — and a traversal that leaves
 * the app — fall back to a full load.
 *
 * Each action resolves with a {@link NavigationOutcome}; `rendered` waits for the destination's DOM
 * commit. Failed or superseded intercepted navigations reject, with `AbortError` on supersession.
 *
 * Soft navigation is the browser's
 * {@link https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API | Navigation API}; where that is
 * missing, every action below is still correct and simply performs a real browser load.
 *
 * @example
 * ```tsx
 * const { router } = useNavigation();
 * router.push('/dashboard');    // navigate, new history entry
 * router.replace('/login');     // navigate, no new entry
 * router.back();                // one entry back, as the browser's button does
 * router.forward();             // one entry forward
 * router.refresh();             // re-run this route's server components
 * ```
 */
export interface NavigationRouter {
  /** Navigates to `href` and pushes a new history entry. */
  push(href: string): Promise<NavigationOutcome>;
  /** Navigates to `href`, replacing the current history entry instead of adding one. */
  replace(href: string): Promise<NavigationOutcome>;
  /** Steps one entry back in the browser's session history. Nothing to go back to is a no-op. */
  back(): Promise<NavigationOutcome>;
  /** Steps one entry forward in the browser's session history. A no-op on the newest entry. */
  forward(): Promise<NavigationOutcome>;
  /** Re-fetches the current route from the server, re-running its server components. */
  refresh(): Promise<NavigationOutcome>;
  /** `true` while a soft navigation is in flight — use it to disable controls or show a spinner. */
  pending: boolean;
}

/** The current location plus the {@link NavigationRouter}, as returned by {@link useNavigation}. */
export interface NavigationState {
  /**
   * The full current {@link URL}. This hook returns its own instance, so mutating it affects nothing else
   * — it is not written back to the address bar.
   *
   * During server rendering and hydration, the URL comes from the page payload. After hydration it
   * follows the browser address, including query and fragment changes, independently of page fetching.
   */
  url: URL;
  /** Matched route params for the current page, e.g. `{ id: '42' }` for `/profile/:id`. */
  params: Record<string, string>;
  /** Imperative navigation actions and the `pending` flag. */
  router: NavigationRouter;
}

const noop = (): Promise<NavigationOutcome> => Promise.resolve({ kind: 'no-op' });

const defaultRouter: NavigationRouter = { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, pending: false };

/**
 * Carries the live {@link NavigationRouter} from the hydration runtime to {@link useNavigation}.
 *
 * @internal
 */
export const RouterContext = createContext<NavigationRouter>(defaultRouter);

// Only server-rendered page identity belongs in this provider. Live browser state is composed in
// the public hook, so an address change does not replace the context for the whole payload tree.
type RouteState = { href: string; params: Record<string, string> };
const NavigationContext = createContext<RouteState | null>(null);

function subscribeToBrowserUrl(onStoreChange: () => void): () => void {
  if (typeof navigation !== 'undefined') navigation.addEventListener('currententrychange', onStoreChange);
  window.addEventListener('hashchange', onStoreChange);
  window.addEventListener('popstate', onStoreChange);
  return () => {
    if (typeof navigation !== 'undefined') navigation.removeEventListener('currententrychange', onStoreChange);
    window.removeEventListener('hashchange', onStoreChange);
    window.removeEventListener('popstate', onStoreChange);
  };
}

const readBrowserUrl = (): string => (typeof navigation !== 'undefined' ? navigation.currentEntry?.url : undefined) ?? location.href;

// This immutable snapshot distinguishes hydration from a later client mount. It does not subscribe
// to URL mutations: those updates remain transition-owned. A newly mounted error-boundary child must
// not start from an old payload URL and throw before its layout effect can reconcile the address.
const subscribeToHydration = () => () => {};
const readHydrated = () => true;
const readServerHydrated = () => false;

/**
 * Publishes the per-render location and params for {@link useNavigation} to read. The RSC entry wraps
 * every page in one.
 *
 * @internal
 */
export function RouterProvider({ href, params, children }: { href: string; params: Record<string, string>; children: ReactNode }) {
  const route = useMemo(() => ({ href, params }), [href, params]);
  return <NavigationContext.Provider value={route}>{children}</NavigationContext.Provider>;
}

/**
 * The pathname of the payload on screen, for framework components that key themselves to the route.
 * Unlike {@link useNavigation} it tolerates being rendered outside a page: with no navigation context to
 * read it answers `undefined`, so the caller can treat the absent route as "no key".
 *
 * @internal
 */
export function useNavigationPathname(): string | undefined {
  const route = useContext(NavigationContext);
  return route ? new URL(route.href).pathname : undefined;
}

/**
 * Reactive access to the current URL and programmatic navigation, in one hook. Call it from a
 * `'use client'` component.
 *
 * During SSR and hydration, `url` and `params` come from the server payload. After hydration `url`
 * follows the browser address, including on prerendered pages and while the next payload is pending.
 * `params` still describes the displayed page until its replacement commits. `router` holds the
 * imperative actions and a `pending` flag, true while a soft navigation is in flight.
 *
 * A static server-rendered page still cannot depend on a request's query. Client components can read
 * the current query directly through this hook after hydration; no additional effect is required.
 *
 * Hooks can't run in a server component; read the same data there from `getRequestContext()`.
 *
 * @example
 * ```tsx
 * 'use client';
 * import { useNavigation } from '@rshono/core/client';
 *
 * export function NextPage() {
 *   const { url, router } = useNavigation();
 *   const page = Number(url.searchParams.get('page') ?? '1');
 *   return (
 *     <button disabled={router.pending} onClick={() => router.push(`${url.pathname}?page=${page + 1}`)}>
 *       Next {router.pending ? '…' : ''}
 *     </button>
 *   );
 * }
 * ```
 *
 * @returns The current {@link NavigationState}: `url` and `params`, plus `router`
 * ({@link NavigationRouter}) with `push` / `replace` / `back` / `forward` / `refresh` / `pending`.
 * @throws If called outside a page's React tree, where there is no navigation
 *   context to read.
 *
 * @see {@link https://www.rshono.com/docs/api#rshonocoreclient | Docs — `@rshono/core/client`}
 * @see {@link https://www.rshono.com/docs/pages#client-components | Docs — client components}
 */
export function useNavigation(): NavigationState {
  const value = useContext(NavigationContext);
  if (!value) {
    throw new Error(
      "[rshono] useNavigation() must be called inside a 'use client' component rendered by a page. In a server component, read the URL from getRequestContext() instead.",
    );
  }
  const router = useContext(RouterContext);
  // Preserve SSR markup, then read the address independently of page fetching after hydration.
  const hydrated = useSyncExternalStore(subscribeToHydration, readHydrated, readServerHydrated);
  const [browserHref, setBrowserHref] = useState(() => (hydrated ? readBrowserUrl() : value.href));
  useLayoutEffect(() => {
    let lastHref: string | undefined;
    const update = () => {
      const href = readBrowserUrl();
      // Several browser events may report the same address; avoid restarting an unchanged transition.
      if (href === lastHref) return;
      lastHref = href;
      startTransition(() => setBrowserHref(href));
    };
    const unsubscribe = subscribeToBrowserUrl(update);
    // Catch address changes between rendering and registration, including initial fragments.
    update();
    return unsubscribe;
  }, []);
  return useMemo(() => ({ url: new URL(browserHref), params: value.params, router }), [browserHref, value.params, router]);
}
