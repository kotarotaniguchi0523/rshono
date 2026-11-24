/// <reference types="vite/client" />
import { createFromFetch, createFromReadableStream, createTemporaryReferenceSet, encodeReply, setServerCallback } from '@vitejs/plugin-rsc/browser';
import type { BrowserBundler } from '../contract.js';

export const browser: BrowserBundler = {
  createFromReadableStream: (stream, options) => createFromReadableStream(stream, options),
  createFromFetch: (response, options) => createFromFetch(response, options),
  createTemporaryReferenceSet: () => createTemporaryReferenceSet() as object,
  encodeReply: (value, options) => encodeReply(value as Parameters<typeof encodeReply>[0], options),
  setServerCallback: (callback) => setServerCallback(callback),
  // Vite's module preloads and stylesheet links are plain elements rather than a runtime that mints scripts.
  setNonce() {},
  connectDevUpdates({ refetch }) {
    // Client modules are Vite's own Fast Refresh. This is the other half: a server component changed.
    import.meta.hot?.on('rsc:update', () => {
      console.log('[rshono] server components updated');
      void refetch();
    });
  },
};
