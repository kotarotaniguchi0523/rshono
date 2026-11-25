import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsvhono/core';
import transformImports from '@rolldown/plugin-transform-imports';

// Two things an app hands to its toolchain *through* the framework, each behind a switch so the suite can
// build the same source with and without it and compare what came out:
//
//   FIXTURE_COMPILER=1           `react: { compiler: true }` — React Compiler, on the framework's one React plugin
//   FIXTURE_TRANSFORM_IMPORTS=1  a Rolldown plugin in `vite.plugins`, rewriting a barrel import to per-module ones
//   FIXTURE_IMPORT_MAP=client|all  Vite's experimental `build.chunkImportMap`, which the framework refuses
const compiler = process.env.FIXTURE_COMPILER === '1';
const transform = process.env.FIXTURE_TRANSFORM_IMPORTS === '1';
const importMap = process.env.FIXTURE_IMPORT_MAP;

export default defineConfig({
  react: compiler ? { compiler: true } : undefined,
  vite: {
    // Stands in for an icon package: a bare specifier with a barrel behind it.
    resolve: { alias: { 'fixture-icons': fileURLToPath(new URL('./src/vendor/icons', import.meta.url)) } },
    ...(importMap === 'all' ? { build: { chunkImportMap: true } } : null),
    ...(importMap === 'client' ? { environments: { client: { build: { chunkImportMap: true } } } } : null),
    plugins: transform ? [transformImports({ 'fixture-icons': { transform: 'fixture-icons/{{member}}' } })] : [],
  },
});
