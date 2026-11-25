/**
 * Shadows `process.env` with the `PUBLIC_`-only view inside the modules of the SSR environment, so a secret
 * read from a `'use client'` component renders empty on the server rather than leaking into the HTML stream
 * — and SSR keeps agreeing with hydration, which sees the same view through the client build's `define`.
 *
 * A `define` on `process.env` alone is not enough for this: it replaces that exact expression and nothing
 * else, and there are five other ways to write the same read — see {@link MENTIONS_PROCESS}.
 */

/** Whitespace and comments — what may sit before or between directives without ending the prologue. */
const TRIVIA = '(?:\\s|//[^\\n]*(?:\\n|$)|/\\*[\\s\\S]*?\\*/)*';
/** One directive: `'use strict'`, `"use client"`, `'use server'`. The backreference keeps the quotes matched. */
const DIRECTIVE = '([\'"])use [a-z -]+\\1\\s*;?';

/**
 * The whole directive prologue, so the prelude below is inserted *after* every directive rather than after the
 * first one.
 *
 * The repetition is load-bearing. A module with two directives — `"use strict"` beside `'use client'`, which is
 * ordinary output from a published component library, in either order — would otherwise take the prelude
 * *between* them, and a directive preceded by a statement is just an expression: whichever came second would
 * silently stop being a directive. That was survivable while this loader only saw the app's own hand-written
 * source, where `'use client'` comes first and alone; it stopped being survivable when the rule widened to
 * cover `node_modules` (the SSR environment compiles them too).
 *
 * Each repetition has to consume a whole directive, so the nested quantifiers cannot loop on an empty match.
 */
const DIRECTIVE_PROLOGUE = new RegExp(`^${TRIVIA}(?:${DIRECTIVE}${TRIVIA})*`);

/**
 * The gate: a standalone `process` identifier anywhere in the module, not the literal text `process.env`.
 *
 * The prelude replaces the whole `process` *binding*, so every way of reaching the env through that binding is
 * covered once it is emitted — but a gate on `process.env` only ever saw one of them:
 *
 * | source shape                            | `process.env` | this |
 * | --------------------------------------- | ------------- | ---- |
 * | `process.env.DATABASE_URL`              | yes           | yes  |
 * | `const { DATABASE_URL } = process.env`  | yes           | yes  |
 * | `process?.env.DATABASE_URL`             | **no**        | yes  |
 * | `process['env'].DATABASE_URL`           | **no**        | yes  |
 * | `const { env } = process`               | **no**        | yes  |
 * | `const p = process; p.env.DATABASE_URL` | **no**        | yes  |
 *
 * `process?.env` is not a contrived shape — it is how env access is written in code meant to run in a browser
 * and on a server, which is exactly what a `'use client'` component is. Every "no" above rendered a secret into
 * the SSR'd HTML while the browser bundle saw the `PUBLIC_`-only view.
 *
 * `\b` on both sides, so `preprocess`, `processEnv` and `child_process` do not drag the prelude in. The cost of
 * being wrong either way is only bytes: a module that mentions `process` in a comment gets a prelude it does
 * not need.
 *
 * The one shape this cannot cover is a module that declares its own module-scope `process` binding — the
 * prelude would be a redeclaration, and the build fails on it rather than shipping. Naming a module-scope
 * binding after a well-known global is what has to give.
 */
const MENTIONS_PROCESS = /\bprocess\b/;

/**
 * A read of `process` through the global object rather than through the binding — `globalThis.process.env`,
 * `globalThis?.process`, `global['process']`, and the `self` spelling Workers use.
 *
 * A prelude declares a module-scoped binding, so it cannot reach any of these: `globalThis.process` is the real
 * `process` however the module names it. `typeof globalThis.process !== 'undefined' && …` is a real isomorphic
 * idiom, so this is worth saying out loud rather than leaving to be discovered in a rendered page — but only
 * for the app's own source, since a library feature-detecting `globalThis.process?.env?.NODE_ENV` is doing
 * nothing wrong and has no app secret to read.
 */
const GLOBAL_PROCESS = /\b(?:globalThis|global|self)\s*(?:\?\.|\.)?\s*(?:process\b|\[\s*(['"`])process\1\s*\])/;

/**
 * A free `process.env.NODE_ENV` read — the one expression the prelude has to hand back to the optimiser —
 * and the three places that same text can sit without being one.
 *
 * The last alternative is the target. The lookbehind rejects a member read off something else
 * (`this.process.env.NODE_ENV`, `foo.process…`) and a longer identifier (`myprocess`); the trailing `\b`
 * rejects `NODE_ENVIRONMENT`. An optional chain and a computed key are left alone, as a `define` leaves them.
 *
 * The alternatives ahead of it are what keeps this a substitution of *code*: this is text, and without them
 * `throw new Error('set process.env.NODE_ENV')` would come out as `throw new Error('set "production"')`.
 * Comments come first so an apostrophe in one (`// don't`) cannot open a string that swallows the code after
 * it, then strings, then templates.
 *
 * It is a scanner, not a parser, and two things are outside it: a regex literal spelled with unescaped dots
 * (`/process.env.NODE_ENV/`), and an interpolation inside a template, which is consumed with the template
 * around it. The first is the residual risk and a strange thing to write; the second only declines a
 * substitution that would have been valid, which costs bytes and changes nothing. Any position it gets wrong
 * leaves the text exactly as a bare `.replace()` would have, so this can only improve on one.
 */
const NODE_ENV_SCAN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"])(?:\\[\s\S]|(?!\1)[^\\\n])*\1|`(?:\\[\s\S]|[^\\`])*`|(?<![.$\w])process\.env\.NODE_ENV\b/g;

export interface EnvShadowOptions {
  /** The public view of the environment — what the browser bundle's `process.env` is defined as. */
  env: Record<string, string>;
  /** This build's mode, substituted for `process.env.NODE_ENV` so dead branches can still be erased. */
  nodeEnv: string;
}

/** Whether `source` reaches `process` through the global object, where no module-scope binding can shadow it. */
export function readsGlobalProcess(source: string): boolean {
  return GLOBAL_PROCESS.test(source);
}

/**
 * `source` with a module-scope `process` whose `env` is the public view, or `null` when it never mentions
 * `process`.
 *
 * `Object.create` over the real `process`, not a bare `{ env }`: the binding shadows the whole object, and
 * isomorphic code reads `process.version`, `process.nextTick` and the rest.
 */
export function shadowProcessEnv(source: string, { env, nodeEnv }: EnvShadowOptions): string | null {
  // Two steps rather than the regex alone: most modules do not contain the substring at all, which `includes`
  // settles far more cheaply than a scan for word breaks.
  if (!source.includes('process') || !MENTIONS_PROCESS.test(source)) return null;

  // Hand `process.env.NODE_ENV` back to the optimiser before the binding takes it away: a `define` respects
  // lexical scope, so without this every `if (process.env.NODE_ENV === 'production')` in this environment
  // stays a runtime branch and both halves of React are bundled. Not a behaviour change — `NODE_ENV` is the
  // one key of `env` that is this build's mode rather than something read from the host.
  const literal = JSON.stringify(nodeEnv);
  const body = source.replace(NODE_ENV_SCAN, (match) => (match.startsWith('process') ? literal : match));

  const prelude = `const process = Object.assign(Object.create(globalThis.process ?? Object.prototype), { env: ${JSON.stringify(env)} }); `;
  const prologue = DIRECTIVE_PROLOGUE.exec(body)![0];
  return prologue + prelude + body.slice(prologue.length);
}
