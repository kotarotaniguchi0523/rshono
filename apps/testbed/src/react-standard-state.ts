/** What `cacheSignal()` returns — an `AbortSignal`, which the published React types narrow to an opaque one. */
type RenderSignal = AbortSignal | null;

/** How many times `/react-standard`'s loader has actually run, in this process. */
const loads = { count: 0 };
export const countLoad = (): number => ++loads.count;

let previous: RenderSignal = null;
/** Keeps this render's `cacheSignal()` and hands back the one before it, to see what became of that. */
export function swapRenderSignal(next: RenderSignal): RenderSignal {
  const before = previous;
  previous = next;
  return before;
}
