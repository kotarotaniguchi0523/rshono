// `__RSVHONO_CONFIG__` is a global const, and an `import` cannot bring one into scope — a path reference is
// the only way to reach it, which is the whole reason that file is separate. See its header.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../types/rsvhono-config.d.ts" />
/**
 * The request context: {@link getRequestContext} and the {@link RequestContext} it returns, the
 * {@link redirect} / {@link notFound} control-flow helpers, and the {@link onServerError} reporting
 * funnel — plus the `@internal` plumbing that binds a request to the async context.
 *
 * The public half is re-exported by `runtime/server.ts`, which is what `@rsvhono/core/server` resolves
 * to; an app imports that.
 */

import type { Context, Env } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NotFoundSignal, RedirectSignal } from './control.js';

/**
 * HTTP status codes accepted by {@link redirect}.
 *
 * - `301` Moved Permanently, `308` Permanent Redirect — cacheable, permanent.
 * - `302` Found, `307` Temporary Redirect — temporary.
 * - `303` See Other — the default; forces a `GET` on the target, which is what you almost always want
 *   after a form action (post/redirect/get).
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status#redirection_messages | MDN — redirection status codes}
 */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

const contextStorage = new AsyncLocalStorage<Context>();

/** One {@link RequestContext} per Hono {@link Context}, so repeated `getRequestContext()` calls share its lazy getters. */
const wrappers = new WeakMap<Context, RequestContext>();

// Keyed on the Hono context rather than held as a field, so marking a request never forces the lazily
// built `RequestContext` wrapper into existence.
const rendering = new WeakSet<Context>();

/**
 * Marks the request as having entered its page render, which is what makes
 * {@link RequestContext.setHeader} and `ctx.cookies.set()` start throwing.
 *
 * @internal
 */
export function beginPageRender(c: Context): void {
  rendering.add(c);
}

/** The shared refusal for a response write that arrived too late — the message names where it belongs instead. */
function tooLateToWrite(call: string): never {
  throw new Error(
    `[rsvhono] ${call} was called while rendering a page, which is too late to affect the response. ` +
      'A page streams, so its response head is already committed by the time the component runs — the ' +
      'write would land on a full page load and be silently dropped on a soft navigation. Do it from a ' +
      "'use server' action instead; or, in middleware and { type: 'endpoint' } routes — which are handed " +
      "Hono's `c` directly and run outside the request context — with `c.header(…)` / `setCookie(c, …)`.",
  );
}

/** The shared refusal for a Hono `Context` member a page has no way to use. See the stubs on {@link RequestContext}. */
function notOnContext(call: string, instead: string): never {
  throw new Error(
    `[rsvhono] ctx.${call} does not exist. A page returns JSX and the framework builds the response from it, ` +
      `so Hono's response builders have nothing to return to. ${instead}`,
  );
}

// Snapshotted rather than spread per request: enumerating `process.env` crosses into the host
// environment (~20µs). Lazily, because `loadEnvFiles()` runs after this module is imported — so a
// mutation after the first `ctx.env` read is not picked up.
let envSnapshot: Record<string, string | undefined> | undefined;

function processEnv(): Record<string, string | undefined> {
  return (envSnapshot ??= typeof process !== 'undefined' && process.env ? { ...process.env } : {});
}

// Set by `build.ts` before it imports the app bundle, which inlines its own copy of this module — so
// `process.env` is what crosses that boundary rather than a module-level flag.
const prerendering = typeof process !== 'undefined' && !!process.env?.RSVHONO_PRERENDER;

/**
 * Runs `fn` with `c` bound as the ambient request context, so {@link getRequestContext} resolves to it
 * anywhere in the call tree.
 *
 * @internal
 */
export function runWithContext<T>(c: Context, fn: () => T): T {
  return contextStorage.run(c, fn);
}

/**
 * The matched route params, or an empty object when there is no active match.
 *
 * @internal
 */
export function readParams(c: Context): Record<string, string> {
  try {
    return c.req.param();
  } catch {
    return {};
  }
}

/** A proxy chain appends to these headers, so the client-facing value is the first entry. */
function firstForwardedValue(header: string | undefined): string | undefined {
  const first = header?.split(',')[0]?.trim();
  return first || undefined;
}

// Read through `typeof`: DefinePlugin inlines this into the server bundle, but the module is also the
// public `@rsvhono/core/server` entry, which tooling can load without one. Absent means don't trust.
const trustProxy = typeof __RSVHONO_CONFIG__ !== 'undefined' && __RSVHONO_CONFIG__.trustProxy;

// Read the same way, for the same reason. Absent means the platform passes no bindings — see the getter.
const envBindings = typeof __RSVHONO_CONFIG__ !== 'undefined' && __RSVHONO_CONFIG__.envBindings;

/**
 * The browser-facing {@link URL} for a request, resolved from Hono's {@link Context} — a fresh
 * instance per call.
 *
 * `c.req.url` is the internal address the server was reached on, which is wrong behind a proxy;
 * `X-Forwarded-Host` / `-Proto` correct it, but only when `trustProxy` is enabled in
 * `rsvhono.config.ts` — they are client-supplied, so trusting them unconditionally would let anyone
 * dictate the origin of every absolute URL the app builds.
 *
 * This is the form for **middleware**, which is handed `c` and runs outside the request context — and
 * so the way to give Hono's own middleware the origin the browser actually used. In a server component
 * or action, prefer {@link RequestContext.url}, the same value cached per request.
 *
 * @param c - The Hono {@link Context} for the request.
 * @returns The browser-facing URL — proxy-corrected under `trustProxy`, `c.req.url` otherwise.
 *
 * @example
 * ```ts
 * // src/server.ts — a CSRF check that still works behind a proxy that rewrites Host
 * import { publicUrl } from '@rsvhono/core/server';
 * import { csrf } from 'hono/csrf';
 *
 * server.use(csrf({ origin: (origin, c) => origin === publicUrl(c).origin }));
 * ```
 *
 * @see {@link https://www.rshono.com/docs/configuration#proxy-headers | Docs — proxy headers}
 */
export function publicUrl(c: Context): URL {
  const url = new URL(c.req.url);
  if (!trustProxy) return url;

  const forwardedHost = firstForwardedValue(c.req.header('x-forwarded-host'));
  // Parsed, not assigned to `url.host`: that setter keeps the existing port when the new value has none.
  const forwarded = forwardedHost ? URL.parse(`http://${forwardedHost}`) : null;
  if (forwarded) {
    url.hostname = forwarded.hostname;
    url.port = forwarded.port;
  }

  // Only the two schemes a browser could have requested; anything else leaves the scheme alone.
  const forwardedProto = firstForwardedValue(c.req.header('x-forwarded-proto'));
  if (forwardedProto === 'http' || forwardedProto === 'https') url.protocol = forwardedProto;

  return url;
}

/**
 * The environment available to a request: Workers `Bindings` merged with process env vars. Values not
 * declared in `Bindings` are typed as `string | undefined`. See {@link RequestContext.env}.
 *
 * @see {@link https://hono.dev/docs/getting-started/cloudflare-workers#bindings | Hono — bindings}
 */
export type EnvVars<E extends Env> = E['Bindings'] & Record<string, string | undefined>;

/**
 * Read-mostly wrapper around Hono's {@link Context}, for server components and server actions.
 *
 * Obtain one with {@link getRequestContext}, or take it off a page's `ctx` prop — the same object.
 * Never construct it yourself. One instance is reused for the whole request, so its lazy getters
 * ({@link RequestContext.url}, {@link RequestContext.env}) are computed at most once.
 *
 * The eight members that only throw — `redirect`, `notFound`, `json`, `text`, `html`, `body`, `status`,
 * `header` — are **permanent, and exist to throw**. Every one of them is a silent no-op when reached through
 * {@link RequestContext.hono} from a page, so a stub that names the thing that does work is the difference
 * between a message and a page that renders while quietly ignoring half of what it was asked for. They carry
 * `@deprecated` for the strike-through an editor draws with it, not because they are on the way out: nothing
 * will un-deprecate or remove them, and dropping them would leave `ctx.redirect('/x')` as
 * "property does not exist", which says what is wrong and not what to do.
 *
 * @typeParam E - The Hono {@link Env} describing this app's `Bindings` and `Variables`, so
 *   {@link RequestContext.var} and {@link RequestContext.env} stay typed.
 *
 * @example
 * ```tsx
 * import { getRequestContext } from '@rsvhono/core/server';
 *
 * export default async function Whoami() {
 *   const ctx = getRequestContext();
 *   const session = ctx.cookies.get('session');
 *   return <p>{ctx.url.pathname} — {session ?? 'anonymous'}</p>;
 * }
 * ```
 *
 * @see {@link https://www.rshono.com/docs/api#rsvhonocoreserver | Docs — `@rsvhono/core/server`}
 * @see {@link https://hono.dev/docs/api/context | Hono — Context}, reachable in full via {@link RequestContext.hono}
 */
export class RequestContext<E extends Env = Env> {
  #raw: Context<E>;
  #url?: URL;
  #env?: EnvVars<E>;
  #params?: Record<string, string>;

  /**
   * One instance is created per request and handed out by {@link getRequestContext} or the `ctx` page
   * prop. Application code never calls this.
   *
   * @internal
   */
  constructor(c: Context<E>) {
    this.#raw = c;
  }

  /**
   * The underlying Hono {@link Context} — the escape hatch for what this wrapper does not expose, such
   * as `executionCtx.waitUntil()` on Workers.
   *
   * Its response builders (`redirect`, `json`, `body`, `status`, …) still do nothing from inside a
   * page: reaching them through here bypasses the errors the stubs on this class throw, it does not
   * make them work.
   *
   * @example
   * ```ts
   * getRequestContext().hono.executionCtx.waitUntil(logAsync()); // Workers
   * ```
   *
   * @see {@link https://hono.dev/docs/api/context | Hono — Context}
   */
  // Every member here is a getter or method so that none is *own enumerable*: React's "you cannot pass
  // this to a client component" diagnostic walks `Object.keys` recursively with no cycle guard, and the
  // Hono context graph reaches the socket through `req.raw`. `cookies` is the one own property, and it
  // is a shallow object of four functions.
  get hono(): Context<E> {
    return this.#raw;
  }

  /**
   * The parsed request — method, headers, path params, query and the body readers. Hono's
   * {@link Context.req}, unwrapped, so `ctx.req.header('authorization')` rather than
   * `ctx.hono.req.header(…)`.
   *
   * Reads only; setting a *response* header is {@link RequestContext.setHeader}, deliberately spelled
   * differently.
   *
   * @example
   * ```ts
   * const ctx = getRequestContext();
   * ctx.req.method;                     // 'GET'
   * ctx.req.header('authorization');    // string | undefined
   * ctx.req.query('tab');               // string | undefined
   * ```
   *
   * @see {@link https://hono.dev/docs/api/request | Hono — HonoRequest}
   */
  get req(): Context<E>['req'] {
    return this.#raw.req;
  }

  /**
   * Matched route params for this request, e.g. `{ id: '42' }` for `/profile/:id`. Empty when no route
   * matched.
   *
   * A page is handed the same record as its `params` prop, typed key-by-key from its route path, and
   * that is the better read where it exists. This is for everywhere else — a nested server component,
   * or a `'use server'` action.
   */
  get params(): Record<string, string> {
    return (this.#params ??= readParams(this.#raw as Context));
  }

  /**
   * The browser-facing request URL. Parsed once and cached, so every read within a request returns the
   * same instance — treat it as read-only.
   *
   * `X-Forwarded-Host` / `-Proto` are honoured only when `trustProxy` is enabled in
   * `rsvhono.config.ts`, since any client can send them.
   *
   * @example `const tab = getRequestContext().url.searchParams.get('tab');`
   *
   * @see {@link https://www.rshono.com/docs/configuration#proxy-headers | Docs — proxy headers}
   */
  get url(): URL {
    return (this.#url ??= publicUrl(this.#raw as Context));
  }

  /**
   * Typed variables set by middleware via `c.set('user', …)`, read here as `ctx.var.user`. Type them by
   * parameterising this class's {@link Env}.
   *
   * @example
   * ```ts
   * type AppEnv = { Variables: { user: { id: string } } };
   * const { user } = getRequestContext<AppEnv>().var; // typed, set by your middleware
   * ```
   *
   * @see {@link https://hono.dev/docs/api/context#var | Hono — c.var}
   * @see {@link https://www.rshono.com/docs/hono#typing-the-context | Docs — typing the context}
   */
  get var(): Readonly<E['Variables']> {
    return this.#raw.var;
  }

  /**
   * Environment for the request: process env vars, merged on a bindings platform with the bindings, which
   * win on conflict.
   *
   * The `process.env` half is snapshotted **once per process**, not per request — enumerating it crosses
   * into the host environment, and doing that on every request is a cost with nothing to show for it. So a
   * `process.env` mutation made after the first `ctx.env` read anywhere in the process is never seen here.
   * Read `process.env` directly if you have one. The bindings half is per request, since it comes off the
   * request's own Hono context.
   *
   * Bindings are merged **only where the platform supplies them** — `deploy: 'cloudflare'`, today. Hono's
   * `c.env` is whatever the host passed as the second argument to `app.fetch`, and off Workers that is the
   * adapter's own private state: `{ incoming, outgoing }` on Node and Vercel, the entire invocation —
   * headers, cookies, `authorization` — on Lambda. Merging it would make `ctx.env` uncloneable on one and
   * a disclosure vector on the other, both behind names this type declares `string | undefined`. Reach for
   * {@link RequestContext.hono}`.env` if you really do want the adapter's argument.
   *
   * @example `const key = getRequestContext().env.STRIPE_SECRET_KEY;`
   *
   * @see {@link https://hono.dev/docs/api/context#env | Hono — c.env}
   * @see {@link https://www.rshono.com/docs/configuration#environment-and-secrets | Docs — environment and secrets}
   */
  get env(): EnvVars<E> {
    if (this.#env) return this.#env;
    const bindings = envBindings ? (this.#raw.env as Record<string, unknown> | undefined) : undefined;
    return (this.#env = (bindings ? { ...processEnv(), ...bindings } : processEnv()) as EnvVars<E>);
  }

  /**
   * Read and write request/response cookies.
   *
   * @example
   * ```ts
   * const ctx = getRequestContext();
   * ctx.cookies.get('session');                       // string | undefined
   * ctx.cookies.set('session', id, { httpOnly: true, sameSite: 'Lax', path: '/' });
   * ctx.cookies.delete('session', { path: '/' });
   * ```
   *
   * @see {@link https://hono.dev/docs/helpers/cookie | Hono — cookie helper}, which this wraps
   */
  cookies = {
    /** Reads a single cookie by name, or `undefined` if absent. Safe anywhere, a page included. */
    get: (name: string): string | undefined => getCookie(this.#raw, name),
    /** Reads every cookie as a `{ name: value }` record. Safe anywhere, a page included. */
    all: (): Record<string, string> => getCookie(this.#raw),
    /**
     * Sets a cookie on the response. See Hono's {@link CookieOptions} for `path`, `httpOnly`, `maxAge`
     * and the rest.
     *
     * **Throws inside a page render** — a `Set-Cookie` is a special case of
     * {@link RequestContext.setHeader}. Set cookies from a `'use server'` action, or with Hono's
     * `setCookie(c, …)` in middleware and endpoint routes.
     *
     * @throws If called while a page is rendering, where it could not reach the browser reliably.
     *
     * @see {@link https://hono.dev/docs/helpers/cookie#options | Hono — cookie options}
     */
    set: (name: string, value: string, options?: CookieOptions): void => {
      this.#assertWritable('ctx.cookies.set()');
      setCookie(this.#raw, name, value, options);
    },
    /**
     * Clears a cookie. Pass the same `path`/`domain` it was set with so the browser matches it.
     * Throws inside a page render, exactly as `set` does.
     *
     * @throws If called while a page is rendering.
     */
    delete: (name: string, options?: CookieOptions): void => {
      this.#assertWritable('ctx.cookies.delete()');
      deleteCookie(this.#raw, name, options);
    },
  };

  #assertWritable(call: string): void {
    if (rendering.has(this.#raw as Context)) tooLateToWrite(call);
  }

  /**
   * Sets a header on the response — from a `'use server'` action, which is the one place a request
   * context exists *and* the response is still open.
   *
   * From inside a page it throws: a page streams, so its response head is already committed by then,
   * and the write would land on a full page load but vanish on a soft navigation.
   *
   * Middleware and `{ type: 'endpoint' }` routes are handed Hono's `c` directly and use `c.header(…)`.
   * That is also where a header belonging to the *page* goes — `Cache-Control`, `X-Robots-Tag` — since
   * middleware runs before the render.
   *
   * @param name - Header name, case-insensitive.
   * @param value - Header value.
   * @param options - `{ append: true }` to add another value rather than replace.
   * @throws If called while a page is rendering, where it could not reach the browser reliably.
   *
   * @example
   * ```ts
   * 'use server';
   * export async function logout() {
   *   const ctx = getRequestContext();
   *   ctx.cookies.delete('session', { path: '/' });
   *   ctx.setHeader('clear-site-data', '"cache", "storage"');
   *   redirect('/');
   * }
   * ```
   */
  setHeader(name: string, value: string, options?: { append?: boolean }): void {
    this.#assertWritable('ctx.setHeader()');
    this.#raw.header(name, value, options);
  }

  // Hono's response builders, restated as errors naming what to use instead — through `ctx.hono` every
  // one of them is a silent no-op from a page. Permanent, deliberately: see the class doc. `@deprecated`
  // strikes them through in autocomplete; the unread `..._args` is so `ctx.redirect('/x')` reaches the
  // thrown message rather than an arity error.

  /** @deprecated Not available on a page's context — use `redirect()` from `@rsvhono/core/server`. */
  redirect(..._args: unknown[]): never {
    return notOnContext(
      'redirect(location, status?)',
      "Use `redirect()` from '@rsvhono/core/server', which throws a signal the framework turns into a real redirect.",
    );
  }

  /** @deprecated Not available on a page's context — use `notFound()` from `@rsvhono/core/server`. */
  notFound(..._args: unknown[]): never {
    return notOnContext('notFound()', "Use `notFound()` from '@rsvhono/core/server', which aborts the render and shows the app's not-found page.");
  }

  /** @deprecated A page renders JSX. For a JSON response, use an `{ type: 'endpoint' }` route. */
  json(..._args: unknown[]): never {
    return notOnContext('json(object)', "For a JSON response use an { type: 'endpoint' } route; to read the request body use `ctx.req.json()`.");
  }

  /** @deprecated A page renders JSX. For a text response, use an `{ type: 'endpoint' }` route. */
  text(..._args: unknown[]): never {
    return notOnContext('text(string)', "For a text response use an { type: 'endpoint' } route; to read the request body use `ctx.req.text()`.");
  }

  /** @deprecated A page renders JSX, which the framework turns into HTML for you. */
  html(..._args: unknown[]): never {
    return notOnContext('html(string)', "A page's JSX is already its HTML; for a hand-built HTML response use an { type: 'endpoint' } route.");
  }

  /** @deprecated Not available on a page's context. To read the request body, use `ctx.req`. */
  body(..._args: unknown[]): never {
    return notOnContext(
      'body(data, …)',
      "To read the *request* body use `ctx.req.json()` / `ctx.req.text()` / `ctx.req.formData()`; to build a response, use an { type: 'endpoint' } route.",
    );
  }

  /** @deprecated A page's status is set by the framework — use `notFound()`, or an endpoint route. */
  status(..._args: unknown[]): never {
    return notOnContext(
      'status(code)',
      "A page's status is the framework's: 200, 404 via `notFound()`, 500 when it throws. For any other code use an { type: 'endpoint' } route.",
    );
  }

  /** @deprecated Renamed — use `ctx.setHeader(name, value)`, which is valid from a `'use server'` action. */
  header(..._args: unknown[]): never {
    return notOnContext(
      'header(name, value)',
      "Use `ctx.setHeader(name, value)` from a 'use server' action, or `c.header(…)` in middleware — a page renders too late to set one.",
    );
  }
}

/**
 * The {@link RequestContext} for the current request — URL, cookies, params, env and middleware
 * variables — read from a server component or a server action. Memoised per request, so repeated calls
 * return the same instance.
 *
 * A page is handed that same object as its `ctx` prop, so this import is for everywhere else: a nested
 * server component, or a `'use server'` action module.
 *
 * @typeParam E - The app's Hono {@link Env}, to type {@link RequestContext.var} and {@link RequestContext.env}.
 * @throws If called at module load, where there is no ambient context to resolve.
 * @throws If called while prerendering a `render: 'static'` route, which has no
 *   per-request context at build time — mark the route `render: 'dynamic'` instead.
 *
 * @example
 * ```ts
 * 'use server';
 * import { getRequestContext, redirect } from '@rsvhono/core/server';
 *
 * export async function login(form: FormData) {
 *   getRequestContext().cookies.set('session', String(form.get('email')), { httpOnly: true });
 *   redirect('/dashboard');
 * }
 * ```
 *
 * @see {@link https://www.rshono.com/docs/api#rsvhonocoreserver | Docs — `@rsvhono/core/server`}
 */
export function getRequestContext<E extends Env = Env>(): RequestContext<E> {
  if (prerendering) {
    throw new Error(
      "[rsvhono] getRequestContext() was called while prerendering a `render: 'static'` route. A static page " +
        'is rendered once at build time, so it has no per-request context to read (URL, cookies, ' +
        "headers, env). Change this route to `render: 'dynamic'` so it renders per request, or remove " +
        'the getRequestContext() call.',
    );
  }
  const c = contextStorage.getStore();
  if (!c) {
    throw new Error(
      '[rsvhono] getRequestContext() was called outside a request. It only works inside a server component or a server action, not at module load.',
    );
  }
  let ctx = wrappers.get(c);
  if (!ctx) {
    ctx = new RequestContext(c);
    wrappers.set(c, ctx);
  }
  return ctx as unknown as RequestContext<E>;
}

/**
 * Redirects the request to `location`, by throwing a control signal the framework turns into an HTTP
 * redirect.
 *
 * Because it throws it never returns, so TypeScript narrows away everything after the call and there
 * is nothing to `return`. Don't wrap it in a `try/catch` that swallows the signal.
 *
 * @param location - Absolute path or URL to redirect to, e.g. `/dashboard`.
 * @param status - Redirect {@link RedirectStatus}; defaults to `303` (See Other), which is what makes
 *   the browser follow up with a `GET` after a form action.
 *
 * @example
 * ```ts
 * const session = getRequestContext().cookies.get('session');
 * if (!session) redirect('/login');
 * // session is defined below this line
 * ```
 */
export function redirect(location: string, status: RedirectStatus = 303): never {
  throw new RedirectSignal(location, status);
}

/**
 * Aborts the current render with a 404, rendering the app's `notFound` page.
 *
 * Like {@link redirect} it throws a control signal and never returns, so TypeScript narrows away
 * everything after the call. Don't catch-and-swallow it.
 *
 * **A real 404 status is only possible on a document load.** A soft navigation asks for a flight payload,
 * and that response is committed as `200 text/x-component` the moment the render hands its stream back —
 * before anything is awaited — so there is no shell to beat and calling this from the first line of a page
 * is already too late. The signal still reaches the browser as a digest, and the client recovers by
 * reloading the page for real: correct, but an extra round trip and a full document parse every time. Unlike
 * {@link redirect}, which the same client turns into a soft navigation and which costs nothing. Where the
 * status matters — a crawler, a monitor — decide in Hono middleware, ahead of the render.
 *
 * @example
 * ```tsx
 * export default async function Page({ params }: PageProps<'/users/:id'>) {
 *   const user = await db.user.find(params.id);
 *   if (!user) notFound();
 *   return <Profile user={user} />; // user is non-null here
 * }
 * ```
 */
export function notFound(): never {
  throw new NotFoundSignal();
}

/**
 * Which stage of a request produced an error handed to a {@link ServerErrorHandler}.
 *
 * - `action` — a `'use server'` function threw. React sends the client an opaque marker with no
 *   message in production, so this is the only place the real error is visible.
 * - `render` — a server component threw while the flight payload was being produced.
 * - `ssr` — SSR failed before the HTML shell could be sent, so the `error` page was unreachable too.
 * - `request` — anything else that reached the top-level handler, a thrown endpoint route included.
 */
export type ServerErrorSource = 'action' | 'render' | 'ssr' | 'request';

/**
 * What an {@link ServerErrorHandler} is told about an error, beyond the error itself.
 *
 * @typeParam E - The app's Hono {@link Env}, to type {@link ServerErrorContext.hono}'s `var` and `env`.
 */
export interface ServerErrorContext<E extends Env = Env> {
  /** The stage that produced it — see {@link ServerErrorSource}. */
  source: ServerErrorSource;
  /** The request being served, for the URL, method and headers. */
  request: Request;
  /**
   * The Hono {@link Context} for this request — `hono.var` for whatever middleware put there, such as a
   * request id to correlate the report on, and `hono.env` for a platform that passes bindings.
   *
   * Handed over rather than left to {@link getRequestContext}, which a handler cannot reach: an error with
   * `source: 'request'` is reported from the top-level handler, which runs outside the ambient context.
   */
  hono: Context<E>;
  /**
   * Holds the invocation open until `promise` settles, where the platform has something to ask.
   *
   * Reporting is what this hook exists for, and on a serverless platform a report started here is cut off
   * the moment the response ends unless something keeps the invocation alive. On Cloudflare Workers that is
   * `executionCtx.waitUntil`, which this calls. On the `node` and `vercel` targets there is nothing to hold
   * open — the process outlives the response — so it is a no-op and the report finishes on its own. On
   * `aws-lambda` it is a no-op as well, because `hono/aws-lambda`'s streaming handler exposes no execution
   * context to ask; a slow report there is best-effort, so prefer a tracker that batches over one that
   * round-trips per error.
   *
   * A rejection is logged rather than propagated: reporting can never fail a request.
   */
  waitUntil: (promise: Promise<unknown>) => void;
}

// ── Server functions: who may call one, and whether the page is rendered after it ───────────────────────

/** What a {@link ServerFunctionGuard} is told about the call it is deciding on. */
export interface ServerFunctionCall<E extends Env = Env> {
  /**
   * How the call arrived: `rsc-action` is a call from hydrated client code, `form-action` a `<form>` posted
   * before hydration or with JavaScript off. Both run the same functions.
   */
  kind: 'rsc-action' | 'form-action';
  /**
   * The function's id — `<module key>#<export name>`. For an `rsc-action` the request names it. For a
   * `form-action` it is read off the function React decoded from the form — the plain form, one with
   * arguments bound on the server, a `useActionState` action and a function declared inline all carry it —
   * and is never inferred from the body. A form whose function does not say what it is does not reach the
   * guard at all: with a guard installed it is refused, so a rule written per function cannot be passed by
   * something with no name.
   */
  id: string;
  request: Request;
  /** The Hono context, for whatever middleware put on it: `hono.var.user`, `hono.get('session')`. */
  hono: Context<E>;
}

/**
 * Decides whether a server function may run. Return to allow it; throw to refuse — an `HTTPException`
 * answers with its own status (401, 403), and `redirect()` / `notFound()` work as they do in an action.
 */
export type ServerFunctionGuard<E extends Env = Env> = (call: ServerFunctionCall<E>) => void | Promise<void>;

let functionGuard: ServerFunctionGuard | undefined;

/**
 * Registers a check that runs before **every** server function, however it was called — from client code,
 * from a form with no JavaScript, from the `notFound` page. It is the one place that sees all of them: a
 * route's middleware only covers the calls posted to that route, and a function is callable from any page.
 *
 * It runs after the framework's own refusals (an unknown id, a foreign origin) and before the function is
 * loaded, with the request context bound — `getRequestContext()` works inside it. It is not a replacement
 * for the checks a function makes on its own arguments: the guard is told which function, not what with.
 *
 * Call it once, at the top level of `src/server.ts`. Registering again replaces the previous guard.
 *
 * @example
 * ```ts
 * // src/server.ts
 * import { HTTPException } from 'hono/http-exception';
 * import { beforeServerFunction } from '@rsvhono/core/server';
 *
 * beforeServerFunction(({ hono }) => {
 *   if (!hono.var.user) throw new HTTPException(401, { message: 'Sign in first' });
 * });
 * ```
 */
export function beforeServerFunction<E extends Env = Env>(guard: ServerFunctionGuard<E>): void {
  functionGuard = guard as unknown as ServerFunctionGuard;
}

/**
 * Runs the registered guard for one call. Whatever it throws is the caller's to let through untouched.
 *
 * @internal
 */
/** Whether the app registered a guard — which is when a function that cannot be named must not run. */
export const hasServerFunctionGuard = (): boolean => functionGuard !== undefined;

export async function authorizeServerFunction(c: Context, kind: ServerFunctionCall['kind'], id: string): Promise<void> {
  await functionGuard?.({ kind, id, request: c.req.raw, hono: c as Context<Env> });
}

/** Says whether `origin` — not the app's own — may call server functions. */
export type ServerFunctionOrigins<E extends Env = Env> = readonly string[] | ((origin: string, hono: Context<E>) => boolean);

let trustedOrigins: ServerFunctionOrigins | undefined;

/**
 * Lets other origins call this app's server functions: an admin console on another host, a second app on a
 * sibling domain. By default only the app's own origin can — the framework refuses the rest itself, before
 * the function is decoded, whether or not `csrf()` or `cors()` is mounted.
 *
 * Pass the exact origins (`'https://admin.example'`), or a function for a pattern. This is the framework's
 * check only: a `csrf()` middleware in front still applies its own rule, and a browser on another origin
 * still needs the CORS headers that let it send the request and read the reply.
 *
 * Call it once, at the top level of `src/server.ts`.
 */
export function trustServerFunctionOrigins<E extends Env = Env>(origins: ServerFunctionOrigins<E>): void {
  trustedOrigins = origins as ServerFunctionOrigins;
}

/**
 * Whether `origin` was named by {@link trustServerFunctionOrigins}.
 *
 * @internal
 */
export function isTrustedOrigin(origin: string, c: Context): boolean {
  if (!trustedOrigins) return false;
  return typeof trustedOrigins === 'function' ? trustedOrigins(origin, c as Context<Env>) : trustedOrigins.includes(origin);
}

/** Whether the page is rendered after a server function: always, or only when the function asks. */
export type ServerFunctionRefresh = 'auto' | 'explicit';

let refreshMode: ServerFunctionRefresh = 'auto';

/**
 * Chooses what a server function called from client code is answered with.
 *
 * - `'auto'` (the default): the page the call came from is rendered again after every function, and the reply
 *   carries it alongside the return value. Nothing to remember; every call pays for a render.
 * - `'explicit'`: the reply carries the return value alone, and the page is rendered only when the function
 *   called {@link requestRefresh}. A function that changes nothing the page shows costs no render.
 *
 * A `<form>` posted without JavaScript is answered with the page either way — it is a document request, and
 * a document is the only thing a browser can show for it.
 *
 * Call it once, at the top level of `src/server.ts`.
 */
export function setServerFunctionRefresh(mode: ServerFunctionRefresh): void {
  refreshMode = mode;
}

/** Requests whose server function is running, or has run, and whether it asked for the page. */
const functionRuns = new WeakMap<Context, { refresh: boolean }>();

/**
 * Marks the request as running a server function. Keyed on the Hono context like everything else that lives
 * exactly as long as the request, so nothing outlives it and no second store is needed.
 *
 * @internal
 */
export function beginServerFunction(c: Context): void {
  functionRuns.set(c, { refresh: false });
}

/**
 * Whether the page should be rendered into this request's reply.
 *
 * @internal
 */
export function wantsRefresh(c: Context): boolean {
  return refreshMode === 'auto' || functionRuns.get(c)?.refresh === true;
}

/**
 * Asks for the page the server function was called from to be rendered again, into this call's reply. For
 * {@link setServerFunctionRefresh | `'explicit'`} mode, where that does not happen on its own; under `'auto'`
 * it is already going to, and this changes nothing.
 *
 * Calling it more than once is one request, and one render. Call it after the writes the page should show:
 * the render happens when the function returns.
 *
 * @throws If called outside a server function — a page render has nothing to refresh into.
 *
 * @example
 * ```ts
 * 'use server';
 * import { requestRefresh } from '@rsvhono/core/server';
 *
 * export async function addComment(text: string) {
 *   const comment = await db.comments.insert({ text });
 *   requestRefresh();
 *   return comment.id;
 * }
 * ```
 */
export function requestRefresh(): void {
  const c = contextStorage.getStore();
  const run = c && functionRuns.get(c);
  if (!run)
    throw new Error(
      "[rsvhono] requestRefresh() was called outside a server function. It asks for the calling page to be rendered into a function's reply.",
    );
  run.refresh = true;
}

/** Handler registered with {@link onServerError}. Called for the side effect; its return value is ignored. */
export type ServerErrorHandler<E extends Env = Env> = (error: unknown, context: ServerErrorContext<E>) => void;

let errorHandler: ServerErrorHandler | undefined;

/**
 * The platform's "keep this invocation alive" hook, or a no-op where there is none.
 *
 * `c.executionCtx` *throws* rather than answering `undefined` where a platform has no execution context, so
 * a handler that reached for it itself would have its report swallowed by the guard in
 * {@link reportServerError} — on exactly the platforms where nothing needed holding open.
 */
function keepAlive(c: Context, promise: Promise<unknown>): void {
  // Caught here rather than left to the platform: under `--unhandled-rejections=strict` a rejected report
  // would end the process, and a failed report must never be worse than no report.
  const settled = Promise.resolve(promise).catch((error) => {
    console.error('[rsvhono] a promise passed to the onServerError waitUntil rejected:', error);
  });
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    // No execution context: nothing here cuts the work off, so there is nothing to hold open.
  }
}

/**
 * Errors already forwarded, so one fault is reported once however many stages it crosses.
 *
 * A thrown server action is reported where it is known to be an action and then re-thrown, which lands it in
 * the top-level handler as well — and a funnel that counts the same error twice, under two different
 * `source`s, is worse than one that only ever names the outer stage.
 */
const alreadyReported = new WeakSet<object>();

/**
 * Registers a handler for every error the framework catches, so they can reach an error tracker
 * (Sentry, Datadog, a log pipeline) instead of only `stderr`.
 *
 * Call it once, at the top level of `src/server.ts`, which is imported as the server starts.
 * Registering again replaces the previous handler. Errors still go to `stderr` either way, and a
 * handler that throws is caught and logged — reporting can never fail a request.
 *
 * @typeParam E - The app's Hono {@link Env}, to type the `hono` context the handler is given.
 *
 * @example
 * ```ts
 * // src/server.ts
 * import * as Sentry from '@sentry/node';
 * import { onServerError } from '@rsvhono/core/server';
 *
 * onServerError((error, { source, request, hono, waitUntil }) => {
 *   // `waitUntil` so a serverless invocation is not frozen before the report is sent.
 *   waitUntil(
 *     Sentry.captureException(error, {
 *       tags: { source, requestId: hono.var.requestId },
 *       extra: { url: request.url },
 *     }),
 *   );
 * });
 * ```
 *
 * @see {@link https://www.rshono.com/docs/hono#error-reporting | Docs — error reporting}
 */
export function onServerError<E extends Env = Env>(handler: ServerErrorHandler<E>): void {
  errorHandler = handler as unknown as ServerErrorHandler;
}

/**
 * Logs an error and forwards it to the registered {@link ServerErrorHandler} — the single funnel every
 * caught server-side error goes through.
 *
 * @internal
 */
export function reportServerError(error: unknown, info: { source: ServerErrorSource; hono: Context; message: string }): void {
  // The first stage to recognise it wins, since that is the one that knows what it was. A primitive throw
  // cannot be tracked and is reported wherever it is caught.
  if (typeof error === 'object' && error !== null) {
    if (alreadyReported.has(error)) return;
    alreadyReported.add(error);
  }
  console.error(info.message, error);
  if (!errorHandler) return;
  try {
    errorHandler(error, {
      source: info.source,
      request: info.hono.req.raw,
      // The handler was registered for the app's own `Env`, which `onServerError` erased to store it; this
      // puts the context back in the shape it was registered with. Same trade as {@link getRequestContext}.
      hono: info.hono as Context<Env>,
      waitUntil: (promise) => keepAlive(info.hono, promise),
    });
  } catch (handlerError) {
    console.error('[rsvhono] the onServerError handler threw:', handlerError);
  }
}
