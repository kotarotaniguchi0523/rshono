import { defineConfig } from '@rsvhono/core';

// Nothing to configure: Vite runs PostCSS itself, from `postcss.config.mjs` — the whole of what Tailwind
// needs from the build, and the reason the framework itself has no PostCSS dependency.
export default defineConfig({});
