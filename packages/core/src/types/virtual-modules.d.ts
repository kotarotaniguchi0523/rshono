/// <reference types="vite/client" />
/// <reference types="@vitejs/plugin-rsc/types" />

// Served by `builder/vite-config.ts`: `{ [referenceKey]: exportNames }` in a build, `null` on the dev server.
declare module 'virtual:rshono/server-references' {
  const references: Record<string, string[]> | null;
  export default references;
}
