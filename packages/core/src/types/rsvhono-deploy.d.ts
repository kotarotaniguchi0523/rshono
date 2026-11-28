/**
 * The platform this bundle was built for, behind one import.
 *
 * `@rsvhono/deploy` is a build-time alias, pointed at the selected preset's runtime module by
 * `builder/vite-config.ts` — so the specifier is real to Vite but not to `tsc`, and this
 * declaration is what types it. Framework-internal: an app never imports it.
 */
declare module '@rsvhono/deploy' {
  export const runtime: import('../deploy/contract.js').DeployRuntime;
}
