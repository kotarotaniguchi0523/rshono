/**
 * What a document does when a script it needs will not load — the entry chunk, or a chunk a client component
 * lives in. The usual cause is a deploy: the page names files by hash, and the files are gone.
 *
 * It has to be an inline script in the document, ahead of the entry. `entry.client.tsx` reports a bootstrap
 * that *fails*; it cannot report one that never arrives, because it is the thing that did not arrive.
 *
 * Two signals, one answer. A `<script>` that fails to load fires `error` on itself, which does not bubble but
 * is seen in the capture phase; a later `import()` of a chunk that fails is announced by Vite's own preload
 * helper as `vite:preloadError`. Either way the document is reloaded, which asks the server for a page that
 * names the files it actually has.
 *
 * Once per tab until a boot succeeds — {@link CHUNK_RELOAD_KEY} is released by `entry.client.tsx` when the
 * runtime starts. If the reload does not help, a second one would not either: the page stays as the server
 * rendered it, and a chunk failure goes on to whoever awaits the import. Where `sessionStorage` is not
 * usable nothing can be counted, so nothing is reloaded.
 */

/** Spent by the preamble when it reloads; released once the client runtime has started. */
export const CHUNK_RELOAD_KEY = 'rsvhono:chunk-reload';

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
    `function recover(){if(leaving)return false;try{if(sessionStorage.getItem(k))return false;sessionStorage.setItem(k,"1")}catch(_){return false}` +
    // Mid-parse, the reload waits for the document: what has streamed so far is a page the visitor can read.
    `if(document.readyState==="loading")addEventListener("DOMContentLoaded",function(){location.reload()});else location.reload();return true}` +
    // Not cancelled: Vite then rethrows the import's error to whoever awaited it, which is still the truth
    // about that import. Cancelling it resolves the import with nothing, and the caller fails on that instead.
    `addEventListener("vite:preloadError",recover);` +
    `addEventListener("error",function(event){var t=event.target;if(t&&t.tagName==="SCRIPT"&&t.src&&t.src.indexOf(e)!==-1)recover()},true)})();`
  );
}
