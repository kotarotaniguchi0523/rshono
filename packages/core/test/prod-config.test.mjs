// The security middleware an app registers in `src/server.ts` — Hono's `csrf()`, `bodyLimit()` and
// `secureHeaders()` — plus the one security setting that is still build-time config, `trustProxy`.
//
// Only `trustProxy` needs a build of its own: it is resolved before Vite compiles anything and
// baked into the server bundle. The rest is middleware, so the testbed reads its profile from the
// environment and one build serves every permutation — which is the point of having moved them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildTestbed, FIXTURES_DIR, hiddenFields, serverActionId, startTestbed, stopServer, TESTBED_DIST } from './helpers.mjs';

// One build for the whole file, with the only config setting under test here baked in. The suites
// below differ by environment alone. Serialised with the rest of the suite by
// `--test-concurrency=1`, so this never races another file over `dist/`.
//
// Built *with* `TESTBED_CSP`, which the bundle itself is indifferent to — `src/server.ts` reads it at
// start, so the compiled output is identical either way. What it changes is the prerender pass, which runs
// the app's middleware in the build process: `secureHeaders()` mints a nonce there too. That is the one
// build-time consequence of a runtime setting anywhere in the testbed, and the reason the pass has to ask
// for a document without one — see the prerendered-nonce test below.
/** What that build printed — asserted on by the prerender/nonce test below. */
let buildOutput = '';
before(() => {
  buildOutput = buildTestbed(join(FIXTURES_DIR, 'trust-proxy.config.mjs'), { env: { TESTBED_CSP: '1' } });
});

/** Serves the already-built testbed under `env` for the enclosing suite. */
function serve(env) {
  const app = {};
  before(async () => {
    const server = await startTestbed('start', { env });
    app.base = server.base;
    app.child = server.child;
    app.getOutput = server.getOutput;
  });
  after(() => app.child && stopServer(app.child));
  return app;
}

describe('a hardened server.ts', () => {
  const app = serve({
    TESTBED_CSP: '1',
    TESTBED_BODY_LIMIT: '1024',
    TESTBED_ALLOWED_ORIGINS: 'https://admin.example,https://alt.example:8443',
  });

  test('secureHeaders + NONCE sends a nonce-based CSP and renders static documents per request', async () => {
    const res = await fetch(`${app.base}/`);
    const header = res.headers.get('content-security-policy');
    assert.ok(header, 'missing content-security-policy header');
    const nonce = header.match(/'nonce-([^']+)'/)[1];
    assert.doesNotMatch(header, /unsafe-eval/, 'prod CSP must not allow eval');
    assert.ok((await res.text()).includes(`nonce="${nonce}"`), 'the nonce Hono minted was not stamped on the scripts');

    // A prerendered file is fixed bytes and cannot carry a fresh nonce, so the document falls back to
    // rendering per request while a nonce is in play.
    const ssg = await fetch(`${app.base}/docs/getting-started`);
    assert.ok(ssg.headers.get('content-security-policy'), 'SSG route missing CSP header');
    assert.match(await ssg.text(), /nonce="/);
    // The header the prerender pass reads that fact off (`PRERENDER_NONCE_HEADER`) belongs to the build
    // process alone — a served response must never carry it.
    assert.equal(ssg.headers.get('x-rsvhono-prerender-nonce'), null, 'a build-time marker leaked onto a served response');
  });

  test('two requests get two nonces — the value is per request, not per build', async () => {
    const nonceOf = async () => (await fetch(`${app.base}/`)).headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
    assert.notEqual(await nonceOf(), await nonceOf(), 'a reused nonce is no better than no nonce at all');
  });

  test('the policy closes the gaps default-src does not cover', async () => {
    const header = (await fetch(`${app.base}/`)).headers.get('content-security-policy');
    // None of these are covered by default-src, and each closes an injection route of its own.
    for (const directive of ['base-uri', 'object-src', 'form-action']) {
      assert.match(header, new RegExp(`(^|; )${directive} `), `CSP is missing ${directive}`);
    }
    assert.match(header, /img-src 'self' data: https:\/\/images\.example/, 'the app widened img-src');
    assert.match(header, /frame-ancestors 'self'/);
    assert.match(header, /script-src [^;]*'nonce-/);
  });

  test("the app's own middleware reaches /_static, so an asset carries HSTS and the app's policy", async () => {
    // The hashed bundle used to be mounted *ahead* of src/server.ts, and it is a terminal handler — so
    // `/_static/*` was answered by something none of the app's middleware ever saw. HSTS is the one that
    // materially matters: it is per-response, and a `/_static` request over http is exactly where a
    // downgrade lands. CSP and COOP are moot for a .js file, but their absence is not what an operator
    // reading their own `secureHeaders()` call expects.
    const html = await (await fetch(`${app.base}/`)).text();
    const asset = html.match(/src="(\/_static\/assets\/index-[\w-]+\.js)"/)[1];
    const res = await fetch(app.base + asset);
    await res.text();
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('strict-transport-security'), 'an asset response is missing HSTS');
    assert.ok(res.headers.get('content-security-policy'), "…and the app's policy");
    assert.ok(res.headers.get('x-response-time'), "the app's own middleware did not run for the asset");
    // And the asset's own cache policy still wins: this is the app's middleware wrapping the handler,
    // not replacing it.
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });

  test('the prerendered flight payload is still served from disk — only the document needs a nonce', async () => {
    // A flight payload never carries a nonce (that only goes on the HTML bootstrap), so there is
    // nothing per-request about it and no reason for CSP to cost soft navigations their prerender.
    const res = await fetch(`${app.base}/docs/getting-started`, { headers: { RSC: '1' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /public/, 'still served from disk under CSP');
    assert.ok(res.headers.get('etag'));
    assert.doesNotMatch(await res.text(), /nonce/, 'and it carries no nonce to go stale');
  });

  test('a prerendered document carries no nonce, even from a build whose middleware minted one', async () => {
    // The prerender pass renders through the app's full middleware, so under a nonce policy `secureHeaders()`
    // minted one at *build* time and it was stamped into the file that ships — one frozen value, repeated in
    // every copy. Which of two bad things followed depended on the policy's scope. Global, as here: the file
    // is never served at all (the request has a nonce, so the document is re-rendered), so it was dead bytes
    // under a build reporting pages the deployment would never read. Scoped to some other path: nothing
    // forces a re-render, and the stale build-time nonce ships and is picked up as `__webpack_nonce__`.
    //
    // Read off disk rather than over HTTP, because under this suite's global policy the served document is
    // always a fresh render — the bytes under test are exactly the ones no request here returns.
    const document = readFileSync(join(TESTBED_DIST, 'ssg', 'docs', 'getting-started', 'index.html'), 'utf8');
    assert.ok(document.includes('<title>'), 'the page was prerendered — otherwise there is nothing to assert about');
    assert.doesNotMatch(document, /nonce/, 'a nonce is per request; a prerendered file is not, so it must carry none');
  });

  test('the build says which documents its own nonce policy will re-render, rather than calling them prerendered', async () => {
    // The other half of the same fact, and the half a build log used to get wrong: under this app's global
    // nonce policy none of these documents is ever read, and the summary line said "prerendered 3 static
    // page(s)" about all three. The pass learns it from the render itself — the framework marks a build-time
    // document it minted a nonce for — so this asserts the whole path, from `secureHeaders()` in the app's
    // middleware through to the line a person reads.
    assert.match(buildOutput, /page\(s\) mint a CSP nonce/, 'the build has to say why, once');
    assert.match(buildOutput, /only the flight payload is served from disk/);
    const summary = buildOutput.split('\n').find((line) => line.includes('prerendered') && line.includes('static page(s)'));
    assert.ok(summary, `no prerender summary line in:\n${buildOutput}`);
    for (const path of ['/docs/getting-started', '/docs/deployment']) {
      assert.ok(summary.includes(`${path} (flight only)`), `${path} is served from disk as a payload only, and the summary must say so:\n${summary}`);
    }
  });

  test("csrf()'s origin handler lets the app's allowlist through, and nothing else", async () => {
    // Clearing the CSRF gate means the request fails later on the bogus action id — a 400, not a 403.
    const post = (origin) =>
      fetch(`${app.base}/users`, {
        method: 'POST',
        headers: { Origin: origin, 'sec-fetch-site': 'cross-site', 'x-rsc-action': 'whatever', 'content-type': 'text/plain' },
        body: '[]',
      });

    for (const origin of ['https://admin.example', 'https://alt.example:8443']) {
      const res = await post(origin);
      await res.text();
      assert.notEqual(res.status, 403, `${origin} is on the allowlist and must not be rejected as CSRF`);
    }

    for (const origin of ['https://evil.example', 'file://']) {
      const res = await post(origin);
      await res.text();
      assert.equal(res.status, 403, `${origin} is not on the allowlist and must be rejected`);
    }
  });

  test('a 403 from csrf() keeps its own status rather than becoming the 500 error page', async () => {
    // `csrf()` rejects by throwing an HTTPException, and registering an `onError` at all replaces the
    // Hono default that would have turned it back into a response. Without the framework's
    // passthrough this is a 500 with the app's error page in it.
    const res = await fetch(`${app.base}/users`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'x-rsc-action': 'whatever', 'content-type': 'text/plain' },
      body: '[]',
    });
    assert.equal(res.status, 403);
    assert.doesNotMatch(await res.text(), /<html/i, 'the CSRF rejection should not render a page');
  });

  test('trustProxy: true honours X-Forwarded-* without dragging the internal port along', async () => {
    const flight = await (
      await fetch(`${app.base}/whoami`, {
        headers: { RSC: '1', 'x-forwarded-host': 'proxied.example', 'x-forwarded-proto': 'https' },
      })
    ).text();
    assert.match(flight, /https:\/\/proxied\.example\/whoami/, 'trustProxy should rebuild the URL from the forwarded headers');
    assert.doesNotMatch(flight, /proxied\.example:\d/, 'the internal port must not survive onto a forwarded host that carries none');
  });

  test('a csrf() built on publicUrl() accepts the forwarded origin, and only under trustProxy', async () => {
    // The pairing that makes `trustProxy` mean anything to middleware: Hono's own default compares
    // `Origin` against `c.req.url`, the address this server was reached on, so behind a proxy that
    // rewrites Host every legitimate post rides on `Sec-Fetch-Site` alone. `publicUrl(c)` is the
    // browser's origin instead — and still refuses a forwarded host it was not told to trust, which
    // prod.test.mjs asserts against the default build.
    const res = await fetch(`${app.base}/users`, {
      method: 'POST',
      headers: {
        Origin: 'https://proxied.example',
        'x-forwarded-host': 'proxied.example',
        'x-forwarded-proto': 'https',
        'sec-fetch-site': 'cross-site',
        'x-rsc-action': 'whatever',
        'content-type': 'text/plain',
      },
      body: '[]',
    });
    await res.text();
    assert.equal(res.status, 400, 'should clear the CSRF gate and fail on the unknown action id instead');
  });

  test('bodyLimit rejects an oversized action POST with 413, declared length or not', async () => {
    const oversized = JSON.stringify([{ blob: 'x'.repeat(4096) }]);
    const post = (body, extra) =>
      fetch(`${app.base}/users`, {
        method: 'POST',
        headers: { Origin: app.base, 'x-rsc-action': 'whatever', 'content-type': 'text/plain' },
        body,
        ...extra,
      });

    // Content-Length present: rejected up front, before the body is buffered.
    assert.equal((await post(oversized)).status, 413, 'a body over the cap with a Content-Length should be rejected');

    // No Content-Length (chunked stream): the streaming byte-counter still trips the cap.
    const chunked = await post(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversized));
          controller.close();
        },
      }),
      { duplex: 'half' },
    );
    assert.equal(chunked.status, 413, 'a chunked body over the cap should be rejected too');

    // Under the cap it is processed normally — here failing to resolve the bogus action id (400).
    assert.notEqual((await post('[]')).status, 413, 'a body under the cap must not be rejected as too large');
  });
});

describe('a server.ts with no csrf()', () => {
  const app = serve({ TESTBED_CSRF: 'off' });

  test('a call from another origin is refused by the framework itself, with no csrf() to do it', async () => {
    // This used to be let through: without `csrf()` nothing checked a call from client code, on the grounds
    // that another origin cannot send `x-rsc-action` without a preflight nobody answers. The framework now
    // holds that call to the same origin rule as a form post, so it does not depend on what else is mounted.
    const call = (headers) =>
      fetch(`${app.base}/users`, { method: 'POST', headers: { 'x-rsc-action': 'whatever', 'content-type': 'text/plain', ...headers }, body: '[]' });

    for (const headers of [
      { Origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      { Origin: 'https://evil.example' },
      { Origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      const res = await call(headers);
      assert.equal(res.status, 403, `${JSON.stringify(headers)} must be refused`);
      assert.match(await res.text(), /server function was called from another origin/);
    }

    // The app's own origin and a client that is not a browser both get as far as the id check.
    for (const headers of [{ Origin: app.base }, { Origin: app.base, 'sec-fetch-site': 'same-origin' }, {}]) {
      const res = await call(headers);
      assert.equal(res.status, 400, `${JSON.stringify(headers)} must reach the function lookup`);
      await res.text();
    }
  });

  test('a page route refuses every cross-site form post; an endpoint route is how you take one', async () => {
    // With `csrf()` off, this is the framework's own check and nothing else. It runs on `Sec-Fetch-Site` and
    // the request's shape, *before* the body is read, because deciding whether a post carries an action means
    // buffering an untrusted body to look for a `$ACTION_*` field. So the refusal is not "an action from
    // another site": it is every cross-site form post to a page, action or no action, which is the arrival
    // shape of SAML ACS, OIDC `response_mode=form_post` and most payment-gateway returns.
    const post = (path, contentType) =>
      fetch(`${app.base}${path}`, {
        method: 'POST',
        headers: { Origin: 'https://idp.example', 'sec-fetch-site': 'cross-site', 'content-type': contentType },
        body: contentType === 'application/json' ? '{}' : 'SAMLResponse=abc',
      });

    const page = await post('/login', 'application/x-www-form-urlencoded');
    assert.equal(page.status, 403);
    const message = await page.text();
    // The message used to say "to a server action", which this code cannot know and which is wrong for the
    // post above — there is no action in it. It names the constraint and the way round it instead.
    assert.match(message, /cross-site form post to a page route/, 'the refusal must name what it actually refused');
    assert.match(message, /\{ type: 'endpoint' \}/, 'and the escape hatch, which is otherwise undiscoverable');
    // The same header bag as the framework's other plain-text refusals — see `plainRefusal` in entry.rsc.tsx,
    // and the test beside the plain 404 in prod.test.mjs. This one used to carry `vary` and no cache policy.
    assert.equal(page.headers.get('cache-control'), 'private, no-cache', 'a refusal is not something to store');
    assert.match(page.headers.get('vary') ?? '', /\bRSC\b/);

    // All three `enctype` values a browser form can send, and this is the one that used to be let through:
    // React never writes `text/plain`, so it is the one shape the framework never decodes as an action — and
    // keying the refusal on that classification rather than on the shape left it rendering the page. Nothing
    // could run an action through it, but "refuses every cross-site form post" was not true as written.
    const plain = await post('/login', 'text/plain');
    assert.equal(plain.status, 403, 'the third enctype a browser form can post is a form post too');
    assert.match(await plain.text(), /cross-site form post to a page route/);

    // Keyed on the shape, not on the presence of an action: the same request with a body no browser form can
    // produce is let through, which is what makes the limitation about form posts rather than about actions.
    // A cross-origin `application/json` POST needs a preflight the framework never answers, so a browser
    // cannot make this request at all — only a client that is not a CSRF victim can.
    const asJson = await post('/login', 'application/json');
    await asJson.text();
    assert.notEqual(asJson.status, 403, 'a non-form content type is not the shape a browser can forge');

    // And the widening must not touch a post from the app's own pages. `same-origin` is the label a browser
    // puts on one, and it settles the question on its own — the page renders, as it did before, and no action
    // can be decoded out of a `text/plain` body either way.
    const own = await fetch(`${app.base}/login`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
      body: 'not an action',
    });
    assert.equal(own.status, 200, 'a same-origin text/plain post still renders the page');

    // An `x-rsc-action` that is present and empty. The refusal skipped it — `has()` read the header as "the
    // client-initiated shape, which needs no check" — while the classifier read `get()` and found nothing to
    // dispatch on, so the request went down the *form* branch and ran whatever action its body carried, with
    // the check that stands in front of that branch bypassed. Two readings of one header, and the shape that
    // fell between them was the one nothing is supposed to be able to forge.
    const empty = await fetch(`${app.base}/subscribe`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'x-rsc-action': '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'email=pwn@evil.example',
    });
    await empty.text();
    assert.equal(empty.status, 403, 'an empty action header names no action, so this is a form post like any other');

    // And the documented remedy works: an endpoint calls the app handler directly, so it never reaches this.
    const endpoint = await post('/api/acs', 'application/x-www-form-urlencoded');
    assert.equal(endpoint.status, 200, 'an endpoint route must be able to receive the post a page route cannot');
    assert.deepEqual(await endpoint.json(), { received: 3 }, 'and the handler must actually see the body');
  });
});

// `SSG_CACHE_CONTROL` is `public, max-age=300` and has no config field, deliberately — it is a
// per-response header and `rsvhono.config.ts` is compiled into the bundle. Middleware is the interface,
// and the one thing a reader has to be told is *where* in the middleware it goes.
describe('a server.ts that overrides the prerendered cache policy', () => {
  const app = serve({ TESTBED_SSG_CACHE: '1' });

  test('a header set after `await next()` replaces the framework default; one set before it does not', async () => {
    const res = await fetch(`${app.base}/docs/getting-started`);
    await res.text();
    assert.equal(res.status, 200);
    // The middleware sets `public, max-age=1` before `await next()` and the real value after it. Only the
    // second lands: the SSG path builds its response with `cache-control` in the bag it hands `c.body(...)`,
    // which replaces a header prepared with `c.header(...)`. That is why the recipe has to say "after".
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=604800');
    assert.ok(res.headers.get('etag'), 'a header edit, not a re-render — the prerendered ETag is untouched');
    assert.equal(res.headers.get('vary'), 'RSC', 'and so is the Vary that makes one URL two answers');
  });

  test('the flight payload of the same page is overridden too, since both come off the same path', async () => {
    const res = await fetch(`${app.base}/docs/getting-started`, { headers: { RSC: '1' } });
    await res.text();
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=604800');
  });

  test('a dynamic page outside the middleware keeps `private, no-cache`', async () => {
    const res = await fetch(`${app.base}/`);
    await res.text();
    assert.equal(res.headers.get('cache-control'), 'private, no-cache', 'the default must not be widened for everything');
  });
});

// ── Server functions: one guard, one origin rule, and a reply that need not carry a page ─────────────────

/** The id of an export of the testbed's `actions.ts`, from the one a client chunk is known to call. */
const actionId = (name) => {
  const sibling = serverActionId('Add user');
  return `${sibling.slice(0, sibling.lastIndexOf('#'))}#${name}`;
};

/** A server function called the way client code calls it. */
const callFunction = (base, path, name, args, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Origin: base, rsc: '1', 'x-rsc-action': actionId(name), 'content-type': 'text/plain;charset=UTF-8', ...headers },
    body: JSON.stringify(args),
  });

/** The `raiseSignal` form on `/action-race`, posted the way a browser without JavaScript posts it. */
const postSignalForm = async (base, to, headers = {}) => {
  const html = await (await fetch(`${base}/action-race`)).text();
  const form = /<form[^>]*data-raise-signal[^>]*>(.*?)<\/form>/s.exec(html)?.[1] ?? '';
  const body = new FormData();
  for (const [name, value] of Object.entries(hiddenFields(form))) body.set(name, value);
  body.set('to', to);
  return fetch(`${base}/action-race`, { method: 'POST', headers: { Origin: base, ...headers }, body, redirect: 'manual' });
};

const applied = async (base, label) => (await (await fetch(`${base}/action-race`)).text()).includes(label);

describe('beforeServerFunction: one check in front of every server function', () => {
  const app = serve({ TESTBED_ACTION_GUARD: '1' });
  const unique = (name) => `${name}-${crypto.randomUUID()}`;

  test('a call from client code is refused with the guard’s own status, and does not run', async () => {
    const label = unique('unsigned');
    const res = await callFunction(app.base, '/action-race', 'recordRace', [label, 0]);
    // Not the 400 a malformed call gets and not the error page's 500: the guard said 401, so that is the answer.
    assert.equal(res.status, 401);
    assert.match(await res.text(), /Sign in to call a server function/);
    assert.equal(await applied(app.base, label), false);
  });

  test('a signed-in call runs, and the guard was told which function', async () => {
    const label = unique('signed');
    const before = app.getOutput().length;
    const res = await callFunction(app.base, '/action-race', 'recordRace', [label, 0], { cookie: 'guard=user' });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(await applied(app.base, label), true);
    assert.match(app.getOutput().slice(before), new RegExp(`\\[guard\\] rsc-action ${actionId('recordRace').replace('#', '#')}`));
  });

  test('a form posted without JavaScript goes through the same guard, named by the function it decoded', async () => {
    const before = app.getOutput().length;
    const unsigned = await postSignalForm(app.base, '/users');
    assert.equal(unsigned.status, 401, 'the form is not a way round the guard');
    await unsigned.text();
    // The id is the reference's own — `decodeAction` resolved the function and the function says what it is.
    assert.match(app.getOutput().slice(before), /\[guard\] form-action [0-9a-f]+#raiseSignal/);

    // The guard can tell functions apart on the form path too: this one is for admins.
    const user = await postSignalForm(app.base, '/users', { cookie: 'guard=user' });
    assert.equal(user.status, 403);
    await user.text();

    const admin = await postSignalForm(app.base, '/users', { cookie: 'guard=admin' });
    assert.equal(admin.status, 303);
    assert.equal(admin.headers.get('location'), '/users');
    await admin.body?.cancel();
  });

  test('a function called from the notFound page is guarded like any other', async () => {
    const label = unique('from-404');
    const unsigned = await callFunction(app.base, '/no-such-page', 'recordRace', [label, 0]);
    assert.equal(unsigned.status, 401);
    await unsigned.text();
    assert.equal(await applied(app.base, label), false);

    const signed = await callFunction(app.base, '/no-such-page', 'recordRace', [label, 0], { cookie: 'guard=user' });
    assert.equal(signed.status, 404, 'the page that answered is still the 404');
    await signed.text();
    assert.equal(await applied(app.base, label), true);
  });

  test('a page fetch is not a function call, and is not asked about', async () => {
    const before = app.getOutput().length;
    assert.equal((await fetch(`${app.base}/action-race`, { headers: { rsc: '1' } })).status, 200);
    assert.doesNotMatch(app.getOutput().slice(before), /\[guard\]/);
  });
});

describe('the origin rule with a permissive cors() mounted and no csrf()', () => {
  const app = serve({ TESTBED_CORS: '1', TESTBED_CSRF: 'off', TESTBED_ALLOWED_ORIGINS: 'https://admin.example' });

  test('cors() answers the preflight the framework never would — and the call is refused all the same', async () => {
    const preflight = await fetch(`${app.base}/action-race`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-rsc-action,rsc,content-type',
      },
    });
    // This is the hole: with it answered, a browser on that origin *will* send the call.
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://evil.example');
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /x-rsc-action/);

    const label = `cors-${crypto.randomUUID()}`;
    const res = await callFunction(app.base, '/action-race', 'recordRace', [label, 0], {
      Origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      cookie: 'session=the-victims',
    });
    assert.equal(res.status, 403);
    await res.text();
    assert.equal(await applied(app.base, label), false, 'and the function did not run');
  });

  test('an origin the app named with trustServerFunctionOrigins may call', async () => {
    const label = `trusted-${crypto.randomUUID()}`;
    const res = await callFunction(app.base, '/action-race', 'recordRace', [label, 0], {
      Origin: 'https://admin.example',
      'sec-fetch-site': 'cross-site',
    });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(await applied(app.base, label), true);
  });
});

describe("setServerFunctionRefresh('explicit'): the reply is the result unless the function asks for the page", () => {
  const app = serve({ TESTBED_ACTION_REFRESH: 'explicit' });
  const renders = async () => Number(/data-race-renders="">(\d+)</.exec(await (await fetch(`${app.base}/action-race`)).text())?.[1]);

  test('a function that does not ask is answered with its result alone, and the page is not evaluated', async () => {
    const before = await renders();
    const label = `result-only-${crypto.randomUUID()}`;
    const res = await callFunction(app.base, '/action-race', 'recordRace', [label, 0]);
    const payload = await res.text();
    assert.equal(res.status, 200);
    assert.match(payload, /"resultOnly":true/);
    assert.match(payload, new RegExp(`"returnValue":\\{"ok":true,"value":"${label}"\\}`));
    assert.doesNotMatch(payload, /Action race/, 'no page in the reply');
    // One render between the two readings: the second reading's own. The call added none.
    assert.equal(await renders(), before + 1);
    assert.equal(await applied(app.base, label), true, 'the function itself ran');
  });

  test('requestRefresh() puts the page in the reply — once, however many times it is called', async () => {
    const before = await renders();
    const label = `refreshed-${crypto.randomUUID()}`;
    const res = await callFunction(app.base, '/action-race', 'recordRaceAndRefresh', [label]);
    const payload = await res.text();
    assert.doesNotMatch(payload, /"resultOnly"/);
    assert.match(payload, /Action race/);
    assert.match(payload, new RegExp(label), 'rendered after the write');
    // The call's one render, then this reading's.
    assert.equal(await renders(), before + 2);
  });

  test('a function that throws is still answered with its error and no page', async () => {
    const res = await callFunction(app.base, '/users', 'createUser', ['', '']);
    const payload = await res.text();
    assert.equal(res.status, 500);
    assert.match(payload, /"resultOnly":true/);
    assert.match(payload, /"returnValue":\{"ok":false/);
  });

  test('a form posted without JavaScript is answered with the page, as a document has to be', async () => {
    const res = await postSignalForm(app.base, '/users');
    assert.equal(res.status, 303);
    await res.body?.cancel();

    const html = await (await fetch(`${app.base}/action-race`)).text();
    const body = new FormData();
    for (const [name, value] of Object.entries(hiddenFields(/<form[^>]*data-raise-signal[^>]*>(.*?)<\/form>/s.exec(html)?.[1] ?? '')))
      body.set(name, value);
    const missing = await fetch(`${app.base}/action-race`, { method: 'POST', headers: { Origin: app.base }, body });
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /<!DOCTYPE html>/i);
  });
});
