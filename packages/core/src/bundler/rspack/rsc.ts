import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  loadServerAction,
  renderToReadableStream,
  type ServerEntry,
  type TemporaryReferenceSet,
} from 'react-server-dom-rspack/server';
// A plain import: the SSR entry is put in its own layer by resource path (`builder/rspack-config.ts`), so
// it is compiled against the SSR build of React no matter which module asks for it.
import * as ssrEntry from '../../runtime/entry.ssr.js';
import type { RscBundler } from '../contract.js';

const { serverManifest } = __rspack_rsc_manifest__;

export const rsc: RscBundler = {
  renderToReadableStream: (model, options) =>
    renderToReadableStream(
      model,
      options as { temporaryReferences?: TemporaryReferenceSet; onError?: (error: unknown) => void; signal?: AbortSignal },
    ),
  createTemporaryReferenceSet,
  decodeReply: (body, options) => decodeReply(body, options as { temporaryReferences?: TemporaryReferenceSet }),
  decodeAction: async (body) => decodeAction(body),
  decodeFormState,
  // `async`, so the synchronous throw of a module that cannot be required arrives as a rejection.
  loadServerAction: async (actionId) => loadServerAction(actionId),
  hasServerAction: async (actionId) => Object.hasOwn(serverManifest, actionId),
  // Entries declaring `chunks` are skipped: `loadServerAction` is a bare `__webpack_require__`, so a module
  // that has not been loaded yet throws for a reason that says nothing about the module itself.
  loadableServerActions: () =>
    Object.entries(serverManifest)
      .filter(([, entry]) => (entry.chunks?.length ?? 0) === 0)
      .map(([actionId, entry]) => [actionId, entry.id] as const),
  pageAssets(Page) {
    const entry = Page as ServerEntry<unknown>;
    // Recorded only for a *server* entry — a `'use client'` page carries none. See `assertPageModule`.
    return entry.entryJsFiles ? { js: entry.entryJsFiles, css: entry.entryCssFiles ?? [] } : undefined;
  },
  loadSsr: async () => ssrEntry,
};
