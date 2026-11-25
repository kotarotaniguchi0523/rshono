import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsvhono/core';
import transformImports from '@rolldown/plugin-transform-imports';

// Two things an app hands to its toolchain *through* the framework, each behind a switch so the suite can
// build the same source with and without it and compare what came out:
//
//   FIXTURE_COMPILER=1           `react: { compiler: true }` — React Compiler, on the framework's one React plugin
//   FIXTURE_TRANSFORM_IMPORTS=1  a Rolldown plugin in `vite.plugins`, rewriting a barrel import to per-module ones
const compiler = process.env.FIXTURE_COMPILER === '1';
const transform = process.env.FIXTURE_TRANSFORM_IMPORTS === '1';

export default defineConfig({
  react: compiler ? { compiler: true } : undefined,
  vite: {
    // Stands in for an icon package: a bare specifier with a barrel behind it.
    resolve: { alias: { 'fixture-icons': fileURLToPath(new URL('./src/vendor/icons', import.meta.url)) } },
    plugins: transform ? [transformImports({ 'fixture-icons': { transform: 'fixture-icons/{{member}}' } })] : [],
  },
});
