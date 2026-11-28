'use client';

import { reachLazyClient } from '../reach/lazy-client';

/** Loaded with `import()` from another client component — an edge that exists only in the browser graph. */
export default function ReachabilityLazyClient() {
  return (
    <button data-reach="lazy-client" onClick={() => void reachLazyClient()}>
      lazy client
    </button>
  );
}
