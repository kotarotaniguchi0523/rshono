/**
 * Which server functions each route can reach — the manifest `rsvhono build` writes, and how to read it.
 *
 * A server function in the build can be called from any page URL: the reference allowlist
 * (`server-references.ts`) says a function *exists*, not that the page being asked has anything to do with
 * it. This narrows that to "the page at this route, or something it imports, refers to it" — worked out from
 * Vite's own module graph, in both the server and the browser bundle.
 *
 * **Nothing enforces it yet.** The build writes the manifest and reports on it; a request is not checked
 * against it. A reference a visitor carried over from another page, in client state, is legitimate today and
 * would be refused by enforcement, and that is a compatibility decision this does not make. What is here is
 * what enforcement would be built from, tested on its own.
 *
 * It is reachability, not authorization: several routes behind different middleware can reach one function,
 * and the manifest says nothing about who may call it. That is `beforeServerFunction`.
 */

/** A server reference as React names it on the wire: `<module key>#<export name>`. */
export type FunctionId = string;

export interface RouteFunctionManifest {
  /**
   * Route pattern → the functions its page reaches, sorted. The pattern is the one in `routes.ts`
   * (`/users/:id`), not a URL. `(notFound)` and `(error)` are the two pages that have no pattern.
   */
  routes: Record<string, readonly FunctionId[]>;
  /**
   * Routes whose page could not be traced — no page key on the module, or a page the graph walk never saw.
   * Listed rather than given an empty list (which would say "reaches nothing") or left out (which a reader
   * could take for the same thing).
   */
  unresolved: readonly string[];
  /** Functions in the build that no route reaches: dead code, or reached in a way the graph does not show. */
  unreachable: readonly FunctionId[];
}

/** The two pages a route table names without a pattern. */
export const NOT_FOUND_ROUTE = '(notFound)';
export const ERROR_ROUTE = '(error)';

/**
 * The functions `route` can reach, or `undefined` when the manifest does not know — the route is unresolved,
 * or is not in the manifest at all. `undefined` is not "none" and not "all": a caller that enforces has to
 * refuse on it, and one that only reports has to say so.
 */
export function reachableFunctions(manifest: RouteFunctionManifest, route: string): ReadonlySet<FunctionId> | undefined {
  if (manifest.unresolved.includes(route) || !Object.hasOwn(manifest.routes, route)) return undefined;
  return new Set(manifest.routes[route]);
}

/** Thrown for a server reference the route in question does not reach. */
export class UnreachableServerReferenceError extends Error {
  constructor(readonly reference: FunctionId) {
    super(`[rsvhono] server reference ${reference} is not reachable from this route`);
    this.name = 'UnreachableServerReferenceError';
  }
}

/**
 * The check for one call and everything decoded with it, against one route's functions: the function the
 * request names, and — through React's `onServerReference`, which every decoder takes — each reference found
 * in the arguments, bound to an action, or named by a form. `allowed` being `undefined` refuses everything.
 */
export function createReferenceValidation(allowed: ReadonlySet<FunctionId> | undefined): {
  assertReachable(reference: FunctionId): void;
  onServerReference(reference: { id: string; name: string }): void;
} {
  const assertReachable = (reference: FunctionId): void => {
    if (!allowed?.has(reference)) throw new UnreachableServerReferenceError(reference);
  };
  return { assertReachable, onServerReference: ({ id, name }) => assertReachable(`${id}#${name}`) };
}

/**
 * Joins what the build knows per *page module* with what the route table says each route's page is.
 *
 * @param pageFunctions - Page key → the functions that page's module graph reaches, from the build.
 * @param routePages - Route pattern → the key its page module carries, or `undefined` where it carries none.
 * @param allFunctions - Every function in the build.
 */
export function joinRouteFunctions(
  pageFunctions: Record<string, readonly FunctionId[]>,
  routePages: Record<string, string | undefined>,
  allFunctions: readonly FunctionId[],
): RouteFunctionManifest {
  const routes: Record<string, readonly FunctionId[]> = {};
  const unresolved: string[] = [];
  const reached = new Set<FunctionId>();
  for (const [route, page] of Object.entries(routePages)) {
    if (page === undefined || !Object.hasOwn(pageFunctions, page)) {
      unresolved.push(route);
      continue;
    }
    routes[route] = pageFunctions[page];
    for (const id of pageFunctions[page]) reached.add(id);
  }
  return { routes, unresolved, unreachable: allFunctions.filter((id) => !reached.has(id)).sort() };
}
