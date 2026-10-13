import type { PageProps } from '@rshono/core';
import { NavInfo } from './nav-info';
import { ObservedNavigationRepro } from './navigation-repro';

export default function NavigationAsyncBoundary({ url, nested = false, propagate = false }: PageProps & { nested?: boolean; propagate?: boolean }) {
  return (
    <>
      <h1>{url.pathname}</h1>
      <NavInfo />
      <ObservedNavigationRepro boundary={propagate ? 'propagate' : nested ? 'nested' : 'async'} />
    </>
  );
}
