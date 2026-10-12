import type { PageProps } from '@rshono/core';
import NavigationAsyncBoundary from './navigation-async-boundary';

export default function NavigationAsyncNested(props: PageProps) {
  return <NavigationAsyncBoundary {...props} nested />;
}
