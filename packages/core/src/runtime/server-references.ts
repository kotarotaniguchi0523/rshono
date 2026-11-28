/**
 * Which server action ids exist — the allowlist `renderPage` checks an id against before it loads anything.
 *
 * RSC environment only: it imports the plugin's server runtime.
 */
import { loadServerAction } from '@vitejs/plugin-rsc/rsc/server';
import references from 'virtual:rsvhono/server-references';

const SERVER_REFERENCE = Symbol.for('react.server.reference');

/** `'<module key>#<export name>'` — the id `loadServerAction` takes and the client sends. */
function splitActionId(actionId: string): [key: string, name: string] {
  const at = actionId.lastIndexOf('#');
  return at < 0 ? [actionId, ''] : [actionId.slice(0, at), actionId.slice(at + 1)];
}

/**
 * Whether `actionId` names a server action — answered **without** treating a module that fails to evaluate
 * as unknown. That distinction is the 400-versus-500 one in `renderPage`.
 */
export async function hasServerAction(actionId: string): Promise<boolean> {
  const [key, name] = splitActionId(actionId);
  // A build knows every `'use server'` module and its exports before the first request.
  if (references) return Object.hasOwn(references, key) && references[key].includes(name);

  // The dev server does not: it learns of a `'use server'` module when it transforms it. The plugin refuses
  // a reference it cannot validate before importing anything ("invalid server reference"), which is the one
  // rejection that means *unknown*; any other is the module itself failing, and that is the caller's 500.
  try {
    const action: unknown = await loadServerAction(actionId);
    return typeof action === 'function' && (action as { $$typeof?: symbol }).$$typeof === SERVER_REFERENCE;
  } catch (error) {
    return !/invalid server reference/.test(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The same allowlist, for the references React resolves *while decoding* — a bound action inside a reply's
 * arguments, the action a form names, the one a `useActionState` key points at. Passed to every decoder, so
 * no path loads a module for a reference the direct-call check would have refused.
 *
 * Says nothing on the dev server, where there is no list: the plugin validates each reference itself there.
 */
export const referenceValidation = {
  onServerReference({ id, name }: { id: string; name: string }): void {
    if (references && !(Object.hasOwn(references, id) && references[id].includes(name))) {
      throw new Error(`[rsvhono] unknown server reference ${id}#${name}`);
    }
  },
};

/**
 * `[actionId, moduleKey]` for every action the build registered — what the build-time check and
 * `cannotLoadServerActions` walk. Empty on the dev server, which cannot enumerate them.
 */
export function knownServerActions(): ReadonlyArray<readonly [actionId: string, moduleKey: string]> {
  return references ? Object.entries(references).flatMap(([key, names]) => names.map((name) => [`${key}#${name}`, key] as const)) : [];
}
