import type { PageProps } from '@rshono/core';
import { ObservedNavigationRepro } from './navigation-repro';

export default function NavigationSuspense({ url }: PageProps) {
  // This fixture tests a destination payload suspending, independently of the browser's live address.
  return <ObservedNavigationRepro activity={url.searchParams.get('tab') === 'activity'} />;
}
