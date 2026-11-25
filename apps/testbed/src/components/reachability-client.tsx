'use client';

import { lazy, Suspense } from 'react';
import { reachBarrel } from '../reach/barrel';

const Lazy = lazy(() => import('./reachability-lazy-client'));

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
