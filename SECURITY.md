# Security policy

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub's
[security advisories](https://github.com/rshono/rshono/security/advisories/new), or by email to
lasse@lassetange.com.

A useful report says what an attacker can do, and how you know. If you have one, a minimal app that
reproduces it is worth more than anything else — `npx @rsvhono/create@latest` plus the smallest diff that
shows the problem. Include the rsvhono version, the Node version and the deploy target: several of the
framework's boundaries are implemented per platform, so `cloudflare` and `node` can differ.

You will get an acknowledgement within **3 working days** and an assessment within **7**. If a report is
valid, you will hear what the fix is and when it ships before it does, and you will be credited in the
advisory and the changelog unless you would rather not be.

## Supported versions

The latest published release of `@rsvhono/core` gets security fixes. There are no long-term support
branches: rsvhono pins `vite`, `@vitejs/plugin-rsc` and `react-server-dom-webpack` to exact versions and a release is what
moves them, so a fix backported onto an older pin has not been tested against anything.

## What is in scope

The framework owns four boundaries, and a defect in any of them is a vulnerability rather than a bug:

- **The env split.** A `PUBLIC_`-prefixed variable is meant to be the only thing that can reach the browser,
  in the client bundle and in SSR'd output alike. Anything that gets a non-prefixed variable into either is
  in scope. The one route the framework cannot cover is a read through the global object —
  `globalThis.process.env`, `global.process.env` — because the SSR-side shadow replaces the `process`
  _binding_, which `globalThis.process` goes around. The build warns when a module under `src/` does that;
  read `process.env` directly and the shadow applies.
- **Server action dispatch.** Every `'use server'` export is a public HTTP endpoint by design — that is
  documented, and authenticating inside the action is the app's job. What is _not_ by design: running an
  action the request did not name, running one from a form post made by another origin, or leaking a thrown
  action's message to the client in production.
- **The request context.** `getRequestContext()` resolves per request through `AsyncLocalStorage`. Anything
  that makes one request see another's context, cookies or env is in scope.
- **Prerendered page serving and the response defaults.** Path traversal into the prerender store, a `Vary`
  or `Cache-Control` that lets a shared cache hand one user's page to another, or a redacted error surfacing
  its real message in a production build.

## What is not in scope

- **An app's own middleware, or its absence.** Per-request security is Hono middleware in `src/server.ts` —
  `csrf()`, `bodyLimit()`, `secureHeaders()` — and `create-rsvhono` scaffolds it. An app that removed it is
  not a framework vulnerability.

  The one thing the framework enforces itself is **where a server function may be called from**, because
  that is its own mechanism and not the app's. Both ways a function is called — a form post to a page route,
  and a call from client code carrying `x-rsc-action` — are held to one rule, before anything in the body is
  read and whether or not `csrf()` or `cors()` is registered: an `Origin` that is present has to be the
  app's own, unless the browser itself says `Sec-Fetch-Site: same-origin`, or the app named that origin with
  `trustServerFunctionOrigins()`. A sibling subdomain is another origin (`same-site` is what a browser labels
  it). A request with no `Origin` at all is not a browser and is let through. For a form this applies to
  every post in an `enctype` a browser form can send, since which posts carry a function cannot be known
  without reading the body.

  The call from client code used to rest on CORS alone: `x-rsc-action` is not a safelisted header, so
  another origin needs a preflight the framework never answers. That still holds and is no longer the only
  thing holding — a `cors()` middleware permissive enough to answer that preflight does not open the
  functions up. A bypass of the origin rule is in scope.

  What is **not** enforced: _which_ function a caller may run. Every `'use server'` export in the build can
  be called from any page URL by anyone the origin rule lets through. Authorization is the app's —
  `beforeServerFunction()` is the one place that sees every call, and each function still has to check what
  it is asked to do.

- **Anything reachable only with `trustProxy: true` and no proxy stripping the headers.** That setting is
  documented as "only behind a proxy you control".
- **Dev-server behaviour.** `rsvhono dev` binds `127.0.0.1`, serves unminified source and widens `script-src`
  with `'unsafe-eval'` for React Refresh. It is not a production server and is not hardened as one.
- **Upstream defects in React, Vite, `@vitejs/plugin-rsc`, Hono or `react-server-dom-webpack`.** Report those to their projects;
  tell us too, and the pin will move once a fix is out.
