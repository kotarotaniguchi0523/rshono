/// <reference types="@vitejs/plugin-rsc/types" />
import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from '@vitejs/plugin-rsc/rsc/server';
import references from 'virtual:rshono/server-references';
import type { RscBundler } from '../contract.js';

type Action = (...args: unknown[]) => Promise<unknown>;

const SERVER_REFERENCE = Symbol.for('react.server.reference');

/** `'<module key>#<export name>'` — the id `loadServerAction` takes and the client sends. */
function splitActionId(actionId: string): [key: string, name: string] {
  const at = actionId.lastIndexOf('#');
  return at < 0 ? [actionId, ''] : [actionId.slice(0, at), actionId.slice(at + 1)];
}

async function hasServerAction(actionId: string): Promise<boolean> {
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

export const rsc: RscBundler = {
  renderToReadableStream: (model, options) => renderToReadableStream(model, options),
  createTemporaryReferenceSet: () => createTemporaryReferenceSet() as object,
  decodeReply: <T>(body: string | FormData, options?: { temporaryReferences?: unknown }) => decodeReply(body, options) as Promise<T>,
  decodeAction: (body) => decodeAction(body),
  decodeFormState: async (actionResult, body) => (await decodeFormState(actionResult, body)) ?? null,
  loadServerAction: async (actionId) => (await loadServerAction(actionId)) as Action,
  hasServerAction,
  loadableServerActions: () =>
    references ? Object.entries(references).flatMap(([key, names]) => names.map((name) => [`${key}#${name}`, key] as const)) : [],
  // Nothing to carry by hand: the plugin injects each server component's CSS where it renders, and the one
  // client entry is the SSR side's to name (`bundler/vite/ssr.ts`). A `'use client'` page is still refused —
  // `assertPageModule` recognises the client reference itself.
  pageAssets: () => ({ js: [], css: [] }),
  loadSsr: () => import.meta.viteRsc.loadModule<typeof import('../../runtime/entry.ssr.js')>('ssr', 'index'),
};
