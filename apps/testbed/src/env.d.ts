declare module '*.css';

// `react-dom` 19.3 exports `browser()`; the testbed installs no `@types/react-dom`, and the published types
// do not declare it yet. Only what `/react-standard` uses.
declare module 'react-dom' {
  /** Suspends a server render at the calling component and resolves in the browser, once hydrated. */
  export function browser(reason?: string): Promise<void>;
}
