import { useSyncExternalStore } from 'react';
import type { RscPayload } from './entry.rsc.js';

type FetchedPayload = { payload: Promise<RscPayload>; settled: Promise<void> };
type Preparation = { href: string; controller: AbortController; fetched: FetchedPayload; detach: () => void };
let active: Preparation | undefined;
const subscribers = new Set<() => void>();
const notify = () => {
  for (const listener of subscribers) listener();
};
const subscribe = (listener: () => void) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};

/** Preparation is pending until the URL commits and the runtime takes ownership of its response. */
export function useNavigationPreparation(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active !== undefined,
    () => false,
  );
}

/** An action or a newer navigation must not commit an older prepared snapshot. */
export function cancelNavigationPreparation(): void {
  const preparation = active;
  if (!preparation) return;
  active = undefined;
  preparation.detach();
  preparation.controller.abort();
  notify();
}

/** Transfers a one-shot response to the ordinary payload loader, including ownership of its stream. */
export function takePreparedPayload(href: string, signal?: AbortSignal): FetchedPayload | undefined {
  const preparation = active;
  if (!preparation || preparation.href !== new URL(href, location.href).href) return undefined;
  active = undefined;
  preparation.detach();
  notify();
  const abort = () => preparation.controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  void preparation.fetched.settled.then(() => signal?.removeEventListener('abort', abort));
  return preparation.fetched;
}

/** Adds URL preparation to interception without owning router results or React render completion. */
export function listenNavigationPreparation(
  fetchPayload: (href: string, signal: AbortSignal) => FetchedPayload,
  shouldIntercept: (event: NavigateEvent) => boolean,
): () => void {
  const onNavigate = (event: NavigateEvent) => {
    if (!shouldIntercept(event) || (event.navigationType !== 'push' && event.navigationType !== 'replace')) return;
    event.intercept({
      precommitHandler: async (controller: NavigationPrecommitController) => {
        cancelNavigationPreparation();
        let href = event.destination.url;
        const visited = new Set<string>();
        let preparation: Preparation | undefined;
        try {
          for (;;) {
            if (visited.has(href) || visited.size >= 10) throw new Error('Redirect loop');
            visited.add(href);
            const requestController = new AbortController();
            const abort = () => {
              requestController.abort(event.signal.reason);
              if (active === preparation) {
                active = undefined;
                notify();
              }
            };
            event.signal.addEventListener('abort', abort, { once: true });
            preparation = {
              href,
              controller: requestController,
              fetched: fetchPayload(href, requestController.signal),
              detach: () => event.signal.removeEventListener('abort', abort),
            };
            active = preparation;
            notify();
            const root = await preparation.fetched.payload;
            if (event.signal.aborted || requestController.signal.aborted) throw requestController.signal.reason ?? event.signal.reason;
            if (!root.redirect) break;
            const target = new URL(root.redirect, href);
            if (target.origin !== location.origin) throw new Error('Cross-origin precommit redirect');
            preparation.detach();
            requestController.abort();
            active = undefined;
            href = target.href;
          }
          if (href !== event.destination.url) controller.redirect(href);
        } catch (error) {
          preparation?.detach();
          preparation?.controller.abort();
          if (active === preparation) active = undefined;
          notify();
          throw error;
        }
      },
    });
  };
  navigation.addEventListener('navigate', onNavigate);
  return () => {
    navigation.removeEventListener('navigate', onNavigate);
    cancelNavigationPreparation();
  };
}
