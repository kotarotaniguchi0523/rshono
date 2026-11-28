/** Scroll and focus across soft navigations: remembered per history entry, restored at commit. */
import { supported } from './document.js';

/** A scroll offset, in the coordinates `window.scrollTo` takes and `window.scrollX`/`window.scrollY` return. */
export type ScrollPoint = { x: number; y: number };

/**
 * Where each history entry of this document was left, keyed by its Navigation API key. In memory for the
 * document's life; {@link persistScrollPositions} also writes it to `sessionStorage` so a reload — which
 * the `manual` mode above stops the browser restoring — lands where the last document was left.
 */
const scrollPositions = new Map<string, ScrollPoint>();

/** The `sessionStorage` key holding {@link scrollPositions}. */
const SCROLL_STORAGE_KEY = 'rsvhono:scroll';

/** How many entries are kept in that snapshot; the oldest falls out first — `Map` iteration order. */
const SCROLL_STORAGE_LIMIT = 50;

/** The key of the history entry being shown. */
export function currentEntryKey(): string | undefined {
  return navigation.currentEntry?.key;
}

/**
 * Records where the outgoing entry is being left. Read at `navigate` time — before the browser commits the
 * new entry — and at `pagehide`, so whatever the navigation turns out to be, the entry it leaves has a
 * position to come back to.
 */
export function rememberCurrentScroll(): void {
  const key = currentEntryKey();
  if (key) scrollPositions.set(key, { x: window.scrollX, y: window.scrollY });
}

/** The position `key` was left at, or `undefined` when this document never saw it. */
export function scrollPointFor(key: string | undefined): ScrollPoint | undefined {
  return key === undefined ? undefined : scrollPositions.get(key);
}

/**
 * Reads the last document's snapshot back into {@link scrollPositions}. Called once, on startup, before the
 * first payload commits: the in-memory map alone would lose every entry the moment the document is replaced.
 */
export function readStoredScrollPositions(): void {
  try {
    const raw = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (!raw) return;
    for (const [key, point] of Object.entries(JSON.parse(raw) as Record<string, ScrollPoint>)) {
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) scrollPositions.set(key, point);
    }
  } catch {
    // Blocked site data, or a snapshot written by a different version. Either way there is nothing to restore,
    // and the page is still correct without it.
  }
}

/** Writes {@link scrollPositions} out, oldest first, bounded — see {@link SCROLL_STORAGE_LIMIT}. */
function persistScrollPositions(): void {
  try {
    while (scrollPositions.size > SCROLL_STORAGE_LIMIT) {
      const oldest = scrollPositions.keys().next().value;
      if (oldest === undefined) break;
      scrollPositions.delete(oldest);
    }
    sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(Object.fromEntries(scrollPositions)));
  } catch {
    // Blocked site data: the in-memory map still carries this document's navigations.
  }
}

/**
 * The snapshot starts with the document, not with hydration: the page is visible and clickable while the
 * initial payload streams, and a reload or a navigation away in that window would otherwise lose the offset
 * now that `manual` has stopped the browser restoring it. Nothing here depends on the router being mounted,
 * so it does not wait for {@link listenNavigation}.
 */
if (supported) {
  window.addEventListener('pagehide', () => {
    rememberCurrentScroll();
    persistScrollPositions();
  });
}

/**
 * Scrolls the document to its start.
 *
 * The options form rather than `scrollTo(0, 0)`: the two-argument call is `auto`, which follows a
 * `scroll-behavior` the app may have set on `html`, and a soft navigation that animates its own reset reads
 * as a glitch rather than a page change.
 */
export function scrollToTop(): void {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

/** Puts a saved offset back. Instant for the same reason {@link scrollToTop} passes it. */
export function scrollToPoint(point: ScrollPoint): void {
  window.scrollTo({ top: point.y, left: point.x, behavior: 'instant' });
}

/**
 * How long a commit waits for a fragment target or `autofocus` element that a boundary has not streamed in
 * yet. Past it the fallback stands — the top of the document, or body focus — and the watch is dropped, so a
 * fragment that names nothing leaves no observer running behind it.
 */
const ELEMENT_WATCH_TIMEOUT_MS = 5_000;

/**
 * Elements a commit asked for that were not in the tree yet: a `#hash` target inside a still-suspended
 * `<AsyncBoundary>`, or the `autofocus` element of a page being traversed into.
 *
 * One `MutationObserver` answers every pending watch. A streamed payload inserts its chunks as separate
 * mutations, so the observer re-checks each watch's lookup until one hits or its timer retires it. A watch is
 * only ever live across one payload: the next navigation drops them all, so a destination the user has left
 * cannot scroll or focus the page that replaced it.
 */
type PendingElementWatch = {
  find: () => Element | null;
  run: (element: Element) => void;
  /** Retires the watch if the element never arrives. */
  timer: ReturnType<typeof setTimeout>;
};

const pendingElementWatches = new Set<PendingElementWatch>();
let elementObserver: MutationObserver | null = null;

function stopElementWatch(watch: PendingElementWatch): void {
  clearTimeout(watch.timer);
  if (!pendingElementWatches.delete(watch)) return;
  if (pendingElementWatches.size === 0) {
    elementObserver?.disconnect();
    elementObserver = null;
  }
}

/** Drops every watch; a new navigation owns the screen from here. */
export function cancelElementWatches(): void {
  for (const watch of [...pendingElementWatches]) stopElementWatch(watch);
}

/**
 * Runs `run` as soon as `find` finds an element, or gives up after {@link ELEMENT_WATCH_TIMEOUT_MS}. When
 * the element is already there, `run` happens synchronously. `find` and `run` are always passed as a matching
 * pair; the type-erasure here is what lets one observer serve watches of different element shapes.
 */
function watchForElement<T extends Element>(find: () => T | null, run: (element: T) => void): void {
  const present = find();
  if (present) {
    run(present);
    return;
  }
  if (elementObserver === null) {
    elementObserver = new MutationObserver(() => {
      for (const watch of [...pendingElementWatches]) {
        const element = watch.find();
        if (element) {
          stopElementWatch(watch);
          watch.run(element);
        }
      }
    });
    elementObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  const watch: PendingElementWatch = {
    find,
    run: run as (element: Element) => void,
    timer: setTimeout(() => stopElementWatch(watch), ELEMENT_WATCH_TIMEOUT_MS),
  };
  pendingElementWatches.add(watch);
}

/**
 * Scrolls to a fragment's target the way the browser's own fragment jump does.
 *
 * `scrollIntoView` is the algorithm that honours `scroll-padding-top` on the scrolling box and
 * `scroll-margin-top` on the target, which `window.scrollTo` does not. The lookup follows the browser's
 * "find a potential indicated element": the id first, then the name. A malformed percent-escape falls back
 * to the literal fragment, and a fragment nothing matches gets the top of the document — what a browser
 * gives a missing anchor on a real load.
 *
 * A streamed payload commits its shell before a target inside a suspended boundary exists, so a miss is not
 * final: the top is applied right away, and the watch follows the fragment in when its element arrives.
 */
export function jumpToAnchor(hash: string): void {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  // No special case for `#top`: the browser only treats it as the top of the document when no element
  // matches, and the fallback below is that top.
  if (raw === '') {
    scrollToTop();
    return;
  }
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // Malformed escape — the literal fragment is the better guess at the id than nothing.
  }
  const find = () => document.getElementById(id) ?? document.getElementsByName(id)[0] ?? null;
  const target = find();
  if (target) {
    target.scrollIntoView();
    return;
  }
  scrollToTop();
  watchForElement(find, (element) => element.scrollIntoView());
}

/**
 * Moves focus the way the browser's `focusReset: 'after-transition'` does: the first `autofocus` element,
 * else the document body. A traversal is no longer intercepted, so the browser performs no focus reset for
 * it; without this, Back would leave focus on the link that was clicked on the page being left, and the next
 * Tab would resume there. `preventScroll` because the traversal's own offset has just been restored.
 *
 * The page may still be streaming — a traversal into a page whose `autofocus` element sits in a suspended
 * boundary — and the browser's own reset follows the element in, so this watches for it with the same bound
 * as a fragment.
 */
export function resetFocus(): void {
  const autofocus = document.querySelector<HTMLElement>('[autofocus]');
  if (autofocus) {
    autofocus.focus({ preventScroll: true });
    return;
  }
  document.body.focus({ preventScroll: true });
  watchForElement(
    () => document.querySelector<HTMLElement>('[autofocus]'),
    (element) => {
      // Only if focus is still where this reset left it: a user who has since focused something else keeps it.
      if (document.activeElement === document.body) element.focus({ preventScroll: true });
    },
  );
}
