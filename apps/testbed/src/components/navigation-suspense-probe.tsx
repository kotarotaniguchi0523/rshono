'use client';

import { Suspense, use } from 'react';
import { useNavigation } from '@rshono/core/client';

let gate: Promise<void> | undefined;

function readClientContent() {
  return (gate ??= fetch('/__navigation-suspense-probe').then(() => {}));
}

function Content() {
  const { url } = useNavigation();
  const activity = url.searchParams.get('tab') === 'activity';
  if (activity) use(readClientContent());
  return <p data-probe="content">{activity ? 'Activity content' : 'Initial content'}</p>;
}

export function NavigationSuspenseProbe() {
  const { router } = useNavigation();
  return (
    <div>
      <button
        onClick={() => {
          router.push('?tab=activity');
        }}
      >
        Navigate to suspended content
      </button>
      <p data-probe="pending">{router.pending ? 'yes' : 'no'}</p>
      <Suspense fallback={<p data-probe="fallback">Loading client content</p>}>
        <Content />
      </Suspense>
    </div>
  );
}
