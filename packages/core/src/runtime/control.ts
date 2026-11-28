/**
 * `redirect()` and `notFound()` as thrown errors, and the `digest` string that carries them.
 *
 * The digest is the only part that survives React — a server component's error reaches the browser as a
 * digest with no message — so the redirect target is encoded into it. The server matches the class, the
 * client matches the string.
 */
const REDIRECT_PREFIX = 'RSVHONO_REDIRECT;';
const NOT_FOUND_DIGEST = 'RSVHONO_NOT_FOUND';
/**
 * Separates a digest from the token of the render that wrote it. Neither digest can contain one of its own:
 * the redirect's location is `encodeURIComponent`-ed, and the other is a constant.
 */
const TOKEN_MARK = '#';

/** What `redirect()` and `notFound()` ask of the router, apart from how the request reached the browser. */
export type RouteIntent = { kind: 'redirect'; location: string; status: number } | { kind: 'not-found' };

/**
 * A digest as it goes on the wire from one render: the signal's own, tagged with that render's token so the
 * browser can tell *which payload* it arrived in. See {@link parseControlIntent}.
 */
export function controlDigestFor(signal: ControlSignal, renderToken: string | undefined): string {
  return renderToken ? `${signal.digest}${TOKEN_MARK}${renderToken}` : signal.digest;
}

const untagged = (digest: string): string => {
  const mark = digest.lastIndexOf(TOKEN_MARK);
  return mark === -1 ? digest : digest.slice(0, mark);
};

/**
 * Reads a route intent out of an error, and the token of the render it came from if it carries one. Reads
 * only: nothing is navigated, reloaded or recorded here. Whether the intent may be *acted on* is a question
 * about the payload it arrived in, which this cannot answer and does not guess at.
 */
export function parseControlIntent(error: unknown): { intent: RouteIntent; renderToken: string | undefined } | undefined {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (!isControlDigest(digest)) return undefined;
  const mark = digest.lastIndexOf(TOKEN_MARK);
  const renderToken = mark === -1 ? undefined : digest.slice(mark + 1);
  const redirect = parseRedirectDigest(digest);
  return { intent: redirect ? { kind: 'redirect', ...redirect } : { kind: 'not-found' }, renderToken };
}

export class RedirectSignal extends Error {
  readonly digest: string;
  constructor(
    readonly location: string,
    readonly status: number,
  ) {
    super(`[rsvhono] redirect to ${location}`);
    this.name = 'RedirectSignal';
    this.digest = `${REDIRECT_PREFIX}${status};${encodeURIComponent(location)}`;
  }
}

export class NotFoundSignal extends Error {
  readonly digest = NOT_FOUND_DIGEST;
  constructor() {
    super('[rsvhono] notFound');
    this.name = 'NotFoundSignal';
  }
}

export type ControlSignal = RedirectSignal | NotFoundSignal;

export function isControlSignal(error: unknown): error is ControlSignal {
  return error instanceof RedirectSignal || error instanceof NotFoundSignal;
}

export function isControlDigest(digest: unknown): digest is string {
  return typeof digest === 'string' && (untagged(digest) === NOT_FOUND_DIGEST || digest.startsWith(REDIRECT_PREFIX));
}

/**
 * Whether an error is React's stand-in for one that came out of a flight payload, rather than one that
 * started life where it was caught. Here, beside {@link isControlDigest}, because both are the same
 * question — what a `digest` tells you about where an error has been.
 *
 * A `digest` is what React puts on the far side of a payload boundary in place of the real error, so its
 * presence *is* the provenance: the layer that wrote the payload met the original and reported it in full.
 * Reporting the stand-in as well tags one fault with a second `source`, and in a build the copy carries no
 * message at all — React redacts it — so the second line says nothing the first did not.
 *
 * `reportServerError` cannot see this for itself: it de-duplicates on object identity, and a stand-in is a
 * different object. Every place a payload error can be reported a second time makes this test — the SSR
 * shell path, the top-level handler, and the `error` page's own catch.
 */
export function cameFromPayload(error: unknown): boolean {
  return typeof (error as { digest?: unknown } | null)?.digest === 'string';
}

export function parseRedirectDigest(digest: string): { location: string; status: number } | null {
  if (!digest.startsWith(REDIRECT_PREFIX)) return null;
  const rest = untagged(digest).slice(REDIRECT_PREFIX.length);
  const sep = rest.indexOf(';');
  if (sep === -1) return null;
  const status = Number(rest.slice(0, sep));
  // A malformed escape is corruption between `RedirectSignal` and here — every target it encodes round
  // trips — and letting `decodeURIComponent` throw would take the redirect off the wire entirely: this runs
  // from React's error callbacks and from a rejected fetch, where a throw escapes as an unhandled rejection
  // or out of the callback. The literal text is the better guess at the target, the same fallback
  // `jumpToAnchor` uses for a malformed fragment; refusing the digest instead would read as a `notFound()`.
  let location: string;
  try {
    location = decodeURIComponent(rest.slice(sep + 1));
  } catch {
    location = rest.slice(sep + 1);
  }
  return { location, status: Number.isFinite(status) ? status : 307 };
}
