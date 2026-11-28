/**
 * Finds the page modules named by inline `component: () => import('…')` thunks in `routes.ts`, so the page
 * transform marks exactly those files. A page wired up any other way declares its `'use server-entry'`
 * directive itself.
 *
 * Only the *finding* is here. Which file a specifier names is Vite's to say — its resolver, in the
 * environment the page is built in — so an alias from `vite.resolve.alias`, an extension the app added to
 * `resolve.extensions` and an `index` file all resolve the way the import itself will, instead of the way a
 * second, smaller resolver once guessed. See `rsvhono:pages` in `vite-config.ts`.
 */

const COMPONENT_THUNK = /component:\s*(?:async\s*)?\(\s*\)\s*=>\s*import\(\s*(['"])([^'"]+)\1\s*\)/g;

/** The specifiers of every inline page thunk in a routes module's source, in the order written. */
export function pageSpecifiers(routesSource: string): string[] {
  return [...routesSource.matchAll(COMPONENT_THUNK)].map((match) => match[2]);
}
