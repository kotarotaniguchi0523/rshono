import { startTransition as globalTransition, useCallback, useLayoutEffect, useRef, useState, useTransition } from 'react';

type NavigationWork = () => void | Promise<void>;
type PayloadTransition = (update: () => void) => void;
let transitionPayload: PayloadTransition = globalTransition;
const documentPart = (href: string): string => {
  const url = new URL(href);
  return url.pathname + url.search;
};

/** Applies a payload inside the root's Transition, independently of the network request. */
export function startNavigationPayload(update: () => void): void {
  transitionPayload(update);
}

/** Owns network pending and restores the committed payload after traversal abandons a destination. */
export function useNavigationTransition<Payload extends object>(
  payload: Payload,
  restorePayload: (payload: Payload) => void,
): readonly [boolean, (run: NavigationWork) => void] {
  const [renderPending, startTransition] = useTransition();
  const [networkPending, setNetworkPending] = useState(false);
  const requests = useRef(new Set<symbol>());
  const committedPayload = useRef(payload);
  const committedDocument = useRef(documentPart(location.href));

  useLayoutEffect(() => {
    transitionPayload = startTransition;
    return () => {
      if (transitionPayload === startTransition) transitionPayload = globalTransition;
    };
  }, [startTransition]);
  useLayoutEffect(() => {
    committedPayload.current = payload;
    committedDocument.current = documentPart(location.href);
  }, [payload]);
  useLayoutEffect(() => {
    if (typeof navigation === 'undefined') return;
    const abandon = () => {
      requests.current.clear();
      setNetworkPending(false);
    };
    const restore = () => {
      if (documentPart(location.href) === committedDocument.current) restorePayload(committedPayload.current);
    };
    navigation.addEventListener('navigate', abandon);
    window.addEventListener('popstate', restore);
    return () => {
      navigation.removeEventListener('navigate', abandon);
      window.removeEventListener('popstate', restore);
    };
  }, [restorePayload]);

  const runNavigation = useCallback((run: NavigationWork) => {
    const work = run();
    if (!work) return;
    const request = Symbol();
    requests.current.add(request);
    setNetworkPending(true);
    const finish = () => {
      if (requests.current.delete(request)) setNetworkPending(requests.current.size !== 0);
    };
    void work.then(finish, finish);
  }, []);

  return [renderPending || networkPending, runNavigation];
}
