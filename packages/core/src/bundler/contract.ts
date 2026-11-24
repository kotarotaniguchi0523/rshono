/**
 * What the runtime entries ask of whichever bundler compiled them.
 *
 * The three entries (`runtime/entry.{rsc,ssr,client}.tsx`) used to import `react-server-dom-rspack` and read
 * Rspack's manifest directly. They now import `@rshono/bundler/{rsc,ssr,browser}`, which the build resolves
 * to one of two implementations — `bundler/rspack/*` (the Rspack alias in `builder/rspack-config.ts`) or
 * `bundler/vite/*` (the resolver in `vite/index.ts`). The same idiom as `@rshono/deploy`.
 *
 * This exists for the length of the Rspack → Vite migration, so both bundlers run the same runtime and the
 * same suite. When the Rspack path is deleted, the Vite implementations can be inlined back into the entries.
 */
import type { ReactFormState } from 'react-dom/client';

/** Opaque: each runtime has its own representation, and the entries only ever pass it back. */
export type ServerTemporaryReferenceSet = object;
export type ClientTemporaryReferenceSet = object;

/** The client assets a document has to carry for one page, beyond what the bundler injects by itself. */
export interface PageAssets {
  js: string[];
  css: string[];
}

export interface RscBundler {
  renderToReadableStream: (
    model: unknown,
    options?: { temporaryReferences?: ServerTemporaryReferenceSet; onError?: (error: unknown) => string | void; signal?: AbortSignal },
  ) => ReadableStream<Uint8Array>;
  createTemporaryReferenceSet: () => ServerTemporaryReferenceSet;
  decodeReply: <T = unknown[]>(body: string | FormData, options?: { temporaryReferences?: ServerTemporaryReferenceSet }) => Promise<T>;
  decodeAction: (body: FormData) => Promise<(() => Promise<unknown>) | null>;
  decodeFormState: (actionResult: unknown, body: FormData) => Promise<ReactFormState | null>;
  /**
   * Rejects when the module the action lives in cannot be loaded. Always a promise: Rspack's is a synchronous
   * `__webpack_require__`, Vite's an `import()`, and the callers have to be written for the slower of the two.
   */
  loadServerAction: (actionId: string) => Promise<(...args: unknown[]) => Promise<unknown>>;
  /**
   * Whether `actionId` names a server action this build registered — answered **without** treating a module
   * that fails to evaluate as unknown. That distinction is the 400-versus-500 one in `renderPage`.
   */
  hasServerAction: (actionId: string) => Promise<boolean>;
  /**
   * `[actionId, moduleId]` for each action whose module can be loaded with nothing else in place — what the
   * build-time probe and `cannotLoadServerActions` walk. Empty where the bundler cannot enumerate them
   * (Vite's dev server, which discovers a `'use server'` module when it is first transformed).
   */
  loadableServerActions: () => ReadonlyArray<readonly [actionId: string, moduleId: string]>;
  /** `undefined` when `Page` is not something this bundler compiled as a page — see `assertPageModule`. */
  pageAssets: (Page: unknown) => PageAssets | undefined;
  /** The SSR entry, which lives in another layer (Rspack) or another environment (Vite). */
  loadSsr: () => Promise<typeof import('../runtime/entry.ssr.js')>;
}

export interface SsrBundler {
  createFromReadableStream: <T>(stream: ReadableStream<Uint8Array>, options?: { nonce?: string }) => Promise<T>;
  /** How the document boots the client: the page's own scripts under Rspack, the one client entry under Vite. */
  bootstrap: (pageScripts: string[] | undefined) => { bootstrapScripts?: string[]; bootstrapModules?: string[] };
}

export interface DevUpdateHooks {
  /** Re-fetch the flight payload for the current URL and commit it, client state preserved. */
  refetch: () => Promise<void>;
  /** Give up on patching the page and load the document again. */
  loadDocument: () => void;
}

export interface BrowserBundler {
  createFromReadableStream: <T>(stream: ReadableStream<Uint8Array>, options?: { temporaryReferences?: ClientTemporaryReferenceSet }) => Promise<T>;
  createFromFetch: <T>(promiseForResponse: Promise<Response>, options?: { temporaryReferences?: ClientTemporaryReferenceSet }) => Promise<T>;
  createTemporaryReferenceSet: () => ClientTemporaryReferenceSet;
  encodeReply: (value: unknown, options?: { temporaryReferences?: ClientTemporaryReferenceSet }) => Promise<string | FormData>;
  setServerCallback: (callback: (id: string, args: unknown[]) => Promise<unknown>) => void;
  /** Hands the document's CSP nonce to whatever the bundler's runtime injects later (chunk scripts, styles). */
  setNonce: (nonce: string) => void;
  /** Dev only: wires the bundler's update channel to the page. A no-op in a production build. */
  connectDevUpdates: (hooks: DevUpdateHooks) => void;
}
