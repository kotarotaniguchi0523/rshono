'use client';

import { Suspense, use, useEffect } from 'react';
import { AsyncBoundary, useNavigation } from '@rshono/core/client';

let resource: Promise<void> | undefined;
let resolveResource: (() => void) | undefined;
let rejectResource: ((error: Error) => void) | undefined;
type BoundaryMode = 'suspense' | 'async' | 'nested' | 'propagate';

function Content({ activity, onActivityRender }: { activity?: boolean; onActivityRender?: () => void }) {
  const { url } = useNavigation();
  useEffect(() => {
    // Expose remounts to the browser test while a URL update is suspended.
    const root = document.documentElement;
    root.dataset.navigationContentMounts = String(Number(root.dataset.navigationContentMounts ?? 0) + 1);
  }, []);
  const showActivity = activity ?? url.searchParams.get('tab') === 'activity';
  if (showActivity && resource) {
    onActivityRender?.();
    use(resource);
    return <p>Activity content</p>;
  }

  return <p>Initial content</p>;
}

export function NavigationRepro({
  activity,
  onActivityRender,
  boundary = 'suspense',
}: {
  activity?: boolean;
  onActivityRender?: () => void;
  boundary?: BoundaryMode;
}) {
  const { url, router } = useNavigation();

  function navigate() {
    resource = new Promise<void>((resolve, reject) => {
      resolveResource = resolve;
      rejectResource = reject;
    });

    router.push('?tab=activity');
  }

  const content = <Content activity={activity} onActivityRender={onActivityRender} />;
  const loading = <p>Loading...</p>;
  const error = (_error: Error, reset: () => void) => (
    <div>
      <p>Resource failed</p>
      <button
        onClick={() => {
          resource = Promise.resolve();
          reset();
        }}
      >
        Retry
      </button>
    </div>
  );
  const inner =
    boundary === 'suspense' ? (
      <Suspense fallback={loading}>{content}</Suspense>
    ) : (
      <AsyncBoundary loading={loading} error={boundary === 'propagate' ? undefined : error} resetKeys={[url.search]}>
        {content}
      </AsyncBoundary>
    );

  return (
    <div data-navigation-repro>
      <button onClick={navigate}>Navigate</button>
      <button onClick={() => resolveResource?.()}>Resolve</button>

      {boundary !== 'suspense' && <button onClick={() => rejectResource?.(new Error('resource rejected on purpose'))}>Reject</button>}
      <p>pending: {String(router.pending)}</p>

      {boundary === 'nested' || boundary === 'propagate' ? (
        <AsyncBoundary loading={<p>Outer loading</p>} error={<p>Outer failed</p>}>
          <p>Outer content</p>
          {inner}
        </AsyncBoundary>
      ) : (
        inner
      )}
    </div>
  );
}

// Observe a render attempt before it suspends; a commit observer cannot see suspended work.
function observeActivityRender() {
  document.documentElement.dataset.activityRenderAttempted = 'true';
}

export function ObservedNavigationRepro({ activity, boundary }: { activity?: boolean; boundary?: BoundaryMode }) {
  useEffect(() => {
    document.documentElement.dataset.navigationReproHydrated = 'true';
  }, []);
  return <NavigationRepro activity={activity} boundary={boundary} onActivityRender={observeActivityRender} />;
}
