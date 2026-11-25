import type { PageProps } from '@rsvhono/core';
import { NavigateOnMount } from './navigate-on-mount';

export default function MountNavigation({ url }: PageProps) {
  return <NavigateOnMount method={url.searchParams.get('method') === 'push' ? 'push' : 'replace'} />;
}
