import type { Styling } from '../options.js';
import { TOOL_VERSIONS } from '../versions.js';
import type { Feature } from './types.js';

/**
 * Tailwind is a PostCSS plugin and nothing more, which is the whole of this feature: three packages, plus an
 * overlay carrying `postcss.config.mjs`, a Tailwind entry stylesheet, and the two views rewritten in
 * utilities. No build config: Vite runs PostCSS itself whenever a `postcss.config.mjs` is there.
 *
 * `postcss` is the app's dependency rather than the framework's, so an app that wants no plugin chain
 * installs none.
 */
const TAILWIND: Feature = {
  id: 'tailwind',
  overlays: ['tailwind'],
  devDependencies: {
    tailwindcss: TOOL_VERSIONS.tailwindcss,
    '@tailwindcss/postcss': TOOL_VERSIONS['@tailwindcss/postcss'],
    postcss: TOOL_VERSIONS.postcss,
  },
};

export function stylingFeature(styling: Styling): Feature | null {
  return styling === 'tailwind' ? TAILWIND : null;
}
