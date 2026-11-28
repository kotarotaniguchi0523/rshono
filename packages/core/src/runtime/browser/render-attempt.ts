/**
 * One request to put a payload on screen, and what became of it.
 *
 * Separate from the {@link PageResource} it shows: the same resource can be shown again — Back onto the page
 * that is still committed, while a later one was suspended — and each showing is its own attempt with its own
 * outcome. The attempt *is* the React state (`root.tsx`), so "which attempt committed" is the identity of the
 * object React hands the layout effect, with nothing to look up.
 */
import { measure, started } from './timing.js';
import type { RscPayload } from '../entry.rsc.js';
import { hold, retire, type PageResource } from './page-resource.js';

/**
 * - `committed` — React committed the tree. The page's shell is on screen; boundaries inside it may still be
 *   suspended.
 * - `superseded` — another attempt was scheduled first. Not a success: this page was never shown.
 * - `failed` — React gave up on the render and tore the root down.
 */
export type RenderOutcome = { kind: 'committed' } | { kind: 'superseded' } | { kind: 'failed'; error: unknown };

export type RenderAttempt = {
  readonly resource: PageResource;
  /** The document URL (path and query) the payload was rendered for. */
  readonly href: string;
  readonly payload: RscPayload;
  /** Settles exactly once. Never rejects. */
  readonly completion: Promise<RenderOutcome>;
  /**
   * Whether a document load can recover this render when React tears it down before it commits. A navigation
   * payload names a URL that renders the failure again — the server answers its document with the app's error
   * page — so the load is the way back. An action reply does not: a GET of the same URL does not re-run the
   * action, so a load would silently discard the error, and the fatal panel is the answer instead.
   */
  readonly recoversByLoad: boolean;
  /** @internal First call wins, and reports whether it was the first. */
  readonly settle: (outcome: RenderOutcome) => boolean;
  /**
   * @internal Runs in the layout effect that commits this attempt: after the new tree is in the DOM and before
   * the browser paints, which is the only moment a `#hash` target exists and the old scroll position has not
   * been shown.
   */
  readonly afterCommit?: () => void;
  /** The React transition type this attempt renders under — see `transitionTypeFor` in `navigation.ts`. */
  readonly transitionType?: string;
};

export type AttemptOptions = { afterCommit?: () => void; recoversByLoad?: boolean; transitionType?: string };

export function createAttempt(
  resource: PageResource,
  payload: RscPayload,
  href: string,
  { afterCommit, recoversByLoad = true, transitionType }: AttemptOptions = {},
): RenderAttempt {
  const { promise: completion, resolve } = Promise.withResolvers<RenderOutcome>();
  let settled = false;
  const settle = (outcome: RenderOutcome): boolean => {
    if (settled) return false;
    settled = true;
    resolve(outcome);
    return true;
  };
  return { resource, href, payload, completion, recoversByLoad, settle, afterCommit, transitionType };
}

/** The attempt React was last asked to show. Equal to {@link committed} when nothing is in flight. */
let scheduled: RenderAttempt | undefined;
/** The attempt on screen. */
let committed: RenderAttempt | undefined;

/** `urgent` skips the transition: the update replaces whatever is pending instead of queueing behind it. */
type Dispatch = (attempt: RenderAttempt, urgent: boolean) => void;

/**
 * Before the root mounts there is nothing to update — `setServerCallback` is already registered, but a call
 * that early has no tree to land in. A reload is the honest answer.
 */
let dispatch: Dispatch = () => window.location.reload();

/** Connects the root's state. Returns the disconnect, for the effect that calls this. */
export function connectRoot(next: Dispatch): () => void {
  dispatch = next;
  return () => {
    if (dispatch === next) dispatch = () => window.location.reload();
  };
}

export const committedAttempt = (): RenderAttempt | undefined => committed;

/** The attempt React has been given and has not committed, if there is one. */
export const pendingAttempt = (): RenderAttempt | undefined => (scheduled !== committed ? scheduled : undefined);

/**
 * Asks React to show `attempt`, in a transition unless `urgent`. Resolves with what became of it — which is
 * decided by React committing it ({@link acknowledgeCommit}), never by this call returning.
 */
export function schedule(attempt: RenderAttempt, { urgent = false }: { urgent?: boolean } = {}): Promise<RenderOutcome> {
  const replaced = pendingAttempt();
  scheduled = attempt;
  replaced?.settle({ kind: 'superseded' });
  hold(attempt.resource);
  // From React being handed the render to whatever becomes of it: committed, superseded or failed.
  const start = started();
  void attempt.completion.then((outcome) => measure(`render ${attempt.href} — ${outcome.kind}`, start));
  dispatch(attempt, urgent);
  return attempt.completion;
}

/** React committed `attempt`. Called from the root's layout effect, with the state it rendered. */
export function acknowledgeCommit(attempt: RenderAttempt): void {
  committed = attempt;
  scheduled ??= attempt;
  // An attempt that was superseded and committed anyway — React finished it before reaching the newer update
  // — stays superseded for whoever awaited it, and its scroll is not applied: the screen is about to change
  // again.
  if (attempt.settle({ kind: 'committed' })) attempt.afterCommit?.();
  // The first moment the trees before this one are out of React. What it may still be reading is this
  // attempt's stream and the next one's.
  retire((resource) => resource === attempt.resource || resource === scheduled?.resource);
}

/**
 * React gave up on a render and unmounted the root. Whoever awaits the pending attempt learns it failed —
 * rather than waiting on a commit that can no longer happen. A render React is only *suspending* never comes
 * through here: it has not given up on it, and neither may the navigation.
 */
export function failPending(error: unknown): RenderAttempt | undefined {
  const pending = pendingAttempt();
  pending?.settle({ kind: 'failed', error });
  return pending;
}
