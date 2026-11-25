'use client';

import { use } from 'react';
import { browser } from 'react-dom';

/**
 * Rendered in the browser only, by React's own means: `browser()` suspends the server render at this
 * component — the nearest `<Suspense>` shows its fallback in the HTML — and resolves once hydrated.
 */
export function BrowserOnly() {
  use(browser('BrowserOnly reads the viewport'));
  return <p data-browser-only>{typeof window === 'undefined' ? 'server' : `viewport ${window.innerWidth > 0 ? 'known' : 'unknown'}`}</p>;
}
