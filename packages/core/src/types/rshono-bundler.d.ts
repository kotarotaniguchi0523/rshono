// Resolved at build time to `bundler/rspack/*` or `bundler/vite/*` — see `bundler/contract.ts`.
declare module '@rshono/bundler/rsc' {
  export const rsc: import('../bundler/contract.js').RscBundler;
}
declare module '@rshono/bundler/ssr' {
  export const ssr: import('../bundler/contract.js').SsrBundler;
}
declare module '@rshono/bundler/browser' {
  export const browser: import('../bundler/contract.js').BrowserBundler;
}
// Served by `vite/index.ts`: `{ [referenceKey]: exportNames }` in a build, `null` on the dev server.
declare module 'virtual:rshono/server-references' {
  const references: Record<string, string[]> | null;
  export default references;
}
