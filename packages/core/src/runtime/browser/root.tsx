/** The React side: one piece of state — the attempt being shown — and the router context around it. */
import { useLayoutEffect, useMemo, useState, useTransition } from 'react';
import { BrowserAddressContext, RouterContext, type NavigationRouter } from '../navigation.js';
import { back, forward, listenNavigation, push, refresh, replace } from './navigation.js';
import { watchPreparing } from './page-resource.js';
import { acknowledgeCommit, connectRoot, type RenderAttempt } from './render-attempt.js';

function subscribeToAddress(onChange: () => void): () => void {
  if (typeof navigation !== 'undefined') navigation.addEventListener('currententrychange', onChange);
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    if (typeof navigation !== 'undefined') navigation.removeEventListener('currententrychange', onChange);
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

const readAddress = (): string => (typeof navigation !== 'undefined' ? navigation.currentEntry?.url : undefined) ?? location.href;

/**
 * What the root renders: the attempt, and the address it is rendered at. One state rather than two because
 * they are one decision. `useNavigation().url` is the address, and a component may suspend on it — so an
 * address that changed in a transition of its own would leave the attempt free to commit, and the navigation
 * to report itself finished, with the page it navigated to still suspended.
 */
type Shown = { attempt: RenderAttempt; address: string };

export function BrowserRoot({ initial }: { initial: RenderAttempt }) {
  const [shown, setShown] = useState<Shown>(() => ({ attempt: initial, address: readAddress() }));
  const [rendering, startTransition] = useTransition();

  useLayoutEffect(
    () =>
      connectRoot((attempt, urgent) => {
        const show = () => setShown({ attempt, address: readAddress() });
        if (urgent) show();
        // Synchronous, and from this hook: the scope ends once the update is scheduled, and React holds
        // `rendering` until that update commits — through any suspension. Nothing awaits the commit in here;
        // the navigation handler does, outside React.
        else startTransition(show);
      }),
    [startTransition],
  );

  // The address moves without an attempt too: a fragment jump, and — where the URL commits before the payload
  // is fetched — the stretch in between. Same hook, so `pending` covers a component suspending on it.
  useLayoutEffect(() => {
    let last: string | undefined;
    const follow = () => {
      const address = readAddress();
      // Several events report one change (`currententrychange`, then `popstate`). A second transition for an
      // address already on its way is not a no-op: on React 19.3.1 it was observed to commit the first with
      // its Suspense fallbacks showing, where one transition alone keeps the previous screen.
      if (address === last) return;
      last = address;
      startTransition(() => setShown((current) => (current.address === address ? current : { ...current, address })));
    };
    const unsubscribe = subscribeToAddress(follow);
    // Catch a change between rendering and subscribing.
    follow();
    return unsubscribe;
  }, [startTransition]);

  // Keyed on the attempt, not on its payload: showing the same payload again is a new attempt, and commits anew.
  useLayoutEffect(() => acknowledgeCommit(shown.attempt), [shown.attempt]);

  useLayoutEffect(() => listenNavigation(), []);

  // `pending` is two halves: a payload still being fetched, which React knows nothing about yet, and the
  // transition rendering it.
  const [preparing, setPreparing] = useState(false);
  useLayoutEffect(() => watchPreparing(setPreparing), []);
  const pending = rendering || preparing;
  const router = useMemo<NavigationRouter>(() => ({ push, replace, back, forward, refresh, pending }), [pending]);

  return (
    <RouterContext.Provider value={router}>
      <BrowserAddressContext.Provider value={shown.address}>{shown.attempt.payload.root}</BrowserAddressContext.Provider>
    </RouterContext.Provider>
  );
}
