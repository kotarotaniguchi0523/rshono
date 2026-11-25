import { defineConfig } from '@rshono/core';

/**
 * Every field is optional — delete this file to accept all the defaults. The commented lines are the
 * defaults, kept as documentation of what is there to change.
 *
 * `trustProxy` is compiled into the server bundle at build time, so changing it means a rebuild; there
 * is no env-var interface for it. The port and bind address are not settings at all — they are
 * `--port` / `PORT` and `HOST`. Per-request security (CSRF, CSP, the body cap) is Hono middleware in
 * `src/server.ts`, not config.
 */
export default defineConfig({
  /** Where `build` targets. Overridable per build with `--deploy` or `RSHONO_DEPLOY`. */
  deploy: 'cloudflare',

  /**
   * Nearly every page here is `render: 'static'`, and they all emit a canonical tag — so this is load
   * bearing rather than decorative. Without it the build warns and every canonical points at localhost.
   */
  siteUrl: 'https://www.rshono.com',

  // trustProxy: false,   // honour X-Forwarded-Host/-Proto — only behind a proxy you control

  vite: {
    // The docs pages import their Markdown as text. (Tailwind needs nothing here: Vite runs PostCSS itself,
    // from `postcss.config.mjs`.)
    plugins: [
      {
        name: 'markdown-source',
        transform(code, id) {
          if (id.endsWith('.md')) return { code: `export default ${JSON.stringify(code)};`, map: null };
        },
      },
    ],
  },
});
