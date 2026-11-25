import type { PageProps } from '@rsvhono/core';
import NavigationAsyncBoundary from './navigation-async-boundary';

export default function NavigationAsyncPropagate(props: PageProps) {
  return <NavigationAsyncBoundary {...props} propagate />;
}
