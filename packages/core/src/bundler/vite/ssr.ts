import { createFromReadableStream, getClientEntryUrl } from '@vitejs/plugin-rsc/ssr';
import type { SsrBundler } from '../contract.js';

export const ssr: SsrBundler = {
  createFromReadableStream: (stream, options) => createFromReadableStream(stream, options),
  // One module entry for every page; route code is reached from it lazily through client references.
  bootstrap: () => ({ bootstrapModules: [getClientEntryUrl()] }),
};
