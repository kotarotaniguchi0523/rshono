/**
 * Keeps a client component rendered on the server from reading the server's environment.
 *
 * A client component runs twice: in the browser, where `process.env` is the `PUBLIC_`-only literal the
 * bundle was given, and in the SSR pass, where it is Node's — every secret on the machine. Rendered there, a
 * `process.env.DATABASE_URL` in a client component ends up in the HTML. So in the SSR environment the free
 * identifier `process` is rebound to an object whose `env` is the same public view the browser gets.
 *
 * The rebinding is Oxc's, through Vite's `transformWithOxc`: `inject` replaces *free* references to a global
 * with an import, which is exactly the scope question a text transform cannot answer. A parameter or a local
 * named `process`, a regex literal, a template string's text, a module that already imports `process` — none
 * is touched, and the directive prologue stays first. `define` hands `process.env.NODE_ENV` back as a
 * literal first, so the bundler can still drop the development half of every branch on it.
 *
 * It is a binding and not a sandbox. `globalThis.process`, and a module that imports `node:process` itself,
 * read the real thing: {@link readsRealProcess} finds those so the build can say so.
 */
import { transformWithOxc } from 'vite';

/** The module the rebound `process` is imported from. One copy for the whole SSR bundle. */
export const PUBLIC_PROCESS_ID = 'virtual:rsvhono/public-process';

/** The source of {@link PUBLIC_PROCESS_ID}: everything `process` has, with `env` narrowed to `env`. */
export function publicProcessModule(env: Record<string, string>): string {
  return `export const process = Object.assign(Object.create(globalThis.process ?? Object.prototype), { env: ${JSON.stringify(env)} });\n`;
}

/** `globalThis.process`, `global['process']`, `self?.process` — reads no binding can stand in front of. */
const GLOBAL_PROCESS = /\b(?:globalThis|global|self)\s*(?:\?\.|\.)?\s*(?:process\b|\[\s*(['"`])process\1\s*\])/;
/** The module's own import of the real `process`, which `inject` rightly leaves alone. */
const IMPORTS_PROCESS = /\bfrom\s*(['"])(?:node:)?process\1|\brequire\(\s*(['"])(?:node:)?process\2\s*\)/;

/**
 * How a module reaches the real `process` past the rebinding, if it does: `'global'` through the global
 * object, `'import'` by importing it. Text-level on purpose — it only decides whether to say something.
 */
export function readsRealProcess(source: string): 'global' | 'import' | null {
  if (IMPORTS_PROCESS.test(source)) return 'import';
  return GLOBAL_PROCESS.test(source) ? 'global' : null;
}

/**
 * Rebinds free references to `process` in `code` to the public view, or returns `null` for a module that
 * never mentions it. `code` is JavaScript already — this runs after every other transform — so nothing here
 * compiles JSX or TypeScript a second time.
 */
export async function shadowProcessEnv(
  code: string,
  id: string,
  nodeEnv: string,
): Promise<Pick<Awaited<ReturnType<typeof transformWithOxc>>, 'code' | 'map'> | null> {
  // A module with no `process` in it at all is not parsed for this.
  if (!/\bprocess\b/.test(code)) return null;
  const result = await transformWithOxc(code, id, {
    lang: 'js',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    inject: { process: [PUBLIC_PROCESS_ID, 'process'] },
    sourcemap: true,
  });
  // Parsed and nothing to do — the word was in a string, a comment, or a binding of the module's own. The
  // module is left exactly as it was rather than swapped for Oxc's reprint of it.
  const rebound = result.code.includes(PUBLIC_PROCESS_ID);
  const replaced = code.includes('process.env.NODE_ENV') && !result.code.includes('process.env.NODE_ENV');
  return rebound || replaced ? { code: result.code, map: result.map } : null;
}
