/**
 * Walking the module graph a build produced, to say what a page can reach. Apart from the plugin that uses it
 * (`rsvhono:route-functions` in `vite-config.ts`) so the walk can be driven with a graph written by hand.
 */

/** The one question asked of the bundler: a module's edges. `null` is "I have no record of that module". */
export interface ModuleGraph {
  getModuleInfo(id: string): { importedIds: readonly string[]; dynamicallyImportedIds: readonly string[]; isExternal?: boolean } | null;
}

export interface GraphWalk {
  /** The client components reached, as the ids the browser build knows them by. */
  clientReferences: Set<string>;
  /** The server functions reached, `<module key>#<export>`. */
  functions: Set<string>;
  /**
   * Whether every module on the way was one the bundler had a record of. `false` means the sets above are
   * what was found *before* the trail went cold, and are a lower bound: the answer for such a root is
   * "unknown", which is not the same as an empty set and must not be reported as one.
   */
  complete: boolean;
}

/**
 * Everything reachable from `roots`, following static and dynamic imports alike — a re-export and a lazy
 * `import()` are edges like any other, and nothing here reads a source file.
 *
 * Four kinds of module, told apart by what the bundler says about them:
 *
 * - **in the graph** — followed;
 * - **external** (a dependency left for the runtime to resolve) — a leaf, and a known one: an app's server
 *   functions live in modules the build transformed, which an external is not;
 * - **tree-shaken** — still in the graph with its edges, so still followed. That over-counts: a function
 *   imported and never used is listed as reachable. Erring that way is the safe direction for a list that
 *   says what a page *may* call;
 * - **no record at all** — `getModuleInfo` returned `null` for something that is not known to be external.
 *   The walk cannot say what lies behind it, and reports itself incomplete.
 */
export function walkModuleGraph(
  graph: ModuleGraph,
  roots: Iterable<string>,
  lookup: { clientReference: (id: string) => string | undefined; serverFunctions: (id: string) => readonly string[] },
): GraphWalk {
  const clientReferences = new Set<string>();
  const functions = new Set<string>();
  const seen = new Set<string>();
  const queue = [...roots];
  let complete = true;
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (seen.has(id)) continue;
    seen.add(id);
    const client = lookup.clientReference(id);
    if (client !== undefined) clientReferences.add(client);
    for (const name of lookup.serverFunctions(id)) functions.add(name);
    const info = graph.getModuleInfo(id);
    if (!info) {
      complete = false;
      continue;
    }
    if (info.isExternal) continue;
    queue.push(...info.importedIds, ...info.dynamicallyImportedIds);
  }
  return { clientReferences, functions, complete };
}
