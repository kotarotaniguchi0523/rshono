/**
 * What a document does when a script it needs will not load. The usual cause is a deploy: the page names
 * files by hash, and the files are gone. Reloading asks the server for a page that names the files it has.
 *
 * There are two halves, because there are two moments.
 *
 * **Before the runtime is up** nothing of ours is running to notice, so the document carries this inline
 * script, ahead of the entry. `entry.client.tsx` can report a bootstrap that fails; it cannot report one that
 * never arrives, because it is the thing that did not arrive. A `<script>` that fails to load fires `error`
 * on itself — seen in the capture phase — and a failed `import()` on the way up is announced by Vite's
 * preload helper as `vite:preloadError`. Either one reloads the document.
 *
 * **Once the runtime is up** it says so ({@link RUNTIME_UP}) and this script stands down. From then on a
 * failed import has an owner, and the event alone does not say which: the page on screen, a navigation on
 * its way in, or a payload fetched ahead that nobody may ever navigate to. Reloading for the last would take
 * the page out from under a visitor who did nothing. So the runtime only remembers which errors were chunk
 * failures (`browser/document.ts`) and acts when React reports one of them from a render — which is the
 * moment a failure has become somebody's.
 *
 * **One reload per {@link CHUNK_RELOAD_WINDOW_MS}, whoever starts it.** The count is a timestamp in
 * `sessionStorage`, never cleared: a reload that did not bring the chunk back is followed by the same failure
 * within moments, and that one is left to whoever awaits the import — the server-rendered page stays, or
 * the error is shown. A failure long after is a different incident and gets its own reload. It is not
 * released by a boot that works, because the chunks that go missing after a boot are exactly the ones a boot
 * does not load; and it is not keyed by build id, because a deployment answering from two builds in turn
 * would then reload from one to the other for as long as it did. Where `sessionStorage` is not usable
 * nothing can be counted, so nothing is reloaded.
 */

/** Where the time of the last chunk reload is kept, by the preamble and by the runtime alike. */
export const CHUNK_RELOAD_KEY = 'rsvhono:chunk-reload';

/** How long one chunk reload stands for every chunk failure after it. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

/** The global the runtime sets when it has started, at which the preamble stops reloading on its own. */
export const RUNTIME_UP = '__rsvhonoUp';

/** A string as a script literal that cannot close the `<script>` it is written into. */
const literal = (value: string): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The preamble, as the text of an inline script. `entryUrl` is the client entry as the plugin names it; the
 * script it is matched against is the one React emits for it.
 */
export function chunkRecoveryPreamble(entryUrl: string): string {
  return (
    `(function(){var k=${literal(CHUNK_RELOAD_KEY)},e=${literal(entryUrl)},leaving=false;` +
    // A page being left fails its imports as a matter of course; that is not a missing chunk. `pageshow`
    // puts the watch back for a page restored from the back/forward cache.
    `addEventListener("pagehide",function(){leaving=true});addEventListener("pageshow",function(){leaving=false});` +
    // The runtime, once up, decides for itself (see the head of this file). And one reload per window: `+v`
    // of a missing key is 0, which no window reaches back to. Written `window > age` so that the script has
    // no `<` in it at all, which is the simplest way to know it cannot close its own tag.
    `function recover(){if(leaving||self[${literal(RUNTIME_UP)}])return false;` +
    `try{if(${CHUNK_RELOAD_WINDOW_MS}>Date.now()-+sessionStorage.getItem(k))return false;sessionStorage.setItem(k,String(Date.now()))}catch(_){return false}` +
    // Mid-parse, the reload waits for the document: what has streamed so far is a page the visitor can read.
    `if(document.readyState==="loading")addEventListener("DOMContentLoaded",function(){location.reload()});else location.reload();return true}` +
    // Not cancelled: Vite then rethrows the import's error to whoever awaited it, which is still the truth
    // about that import. Cancelling it resolves the import with nothing, and the caller fails on that instead.
    `addEventListener("vite:preloadError",recover);` +
    `addEventListener("error",function(event){var t=event.target;if(t&&t.tagName==="SCRIPT"&&t.src&&t.src.indexOf(e)!==-1)recover()},true)})();`
  );
}
