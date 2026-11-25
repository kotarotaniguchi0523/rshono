'use client';

import { lazy, Suspense } from 'react';
import { reachBarrel } from '../reach/barrel';

const Lazy = lazy(() => import('./reachability-lazy-client'));

/**
 * Exported from a client module and rendered by nothing. A client reference is per export, so the browser
 * bundle has no reason to carry this one — the string is how a test checks that it does not.
 */
export function UnusedClientReference() {
  return <p>__unused_client_reference__</p>;
}

/** Reaches one function through a re-export and another through a lazily imported client component. */
export function ReachabilityClient() {
  return (
    <>
      <button data-reach="barrel" onClick={() => void reachBarrel()}>
        barrel
      </button>
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>
    </>
  );
}
