import { createFromReadableStream } from 'react-server-dom-rspack/client';
import type { SsrBundler } from '../contract.js';

export const ssr: SsrBundler = {
  createFromReadableStream,
  bootstrap: (pageScripts) => ({ bootstrapScripts: pageScripts }),
};
