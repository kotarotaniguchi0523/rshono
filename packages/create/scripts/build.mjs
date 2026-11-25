// Vite through its Node API rather than a config file and the CLI: two entries, bundled for Node with their
// one dependency (@clack/prompts) inlined, so the published package installs nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

const dir = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const { output } = await build({
  configFile: false,
  root: dir,
  logLevel: 'warn',
  define: { __CREATE_RSHONO_VERSION__: JSON.stringify(version) },
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { cli: join(dir, 'src', 'cli.ts'), api: join(dir, 'src', 'api.ts') },
      output: {
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name]-[hash].mjs',
        banner: '// Bundled by Vite — edit src/ and rebuild. Includes @clack/prompts (MIT).',
      },
    },
  },
});

for (const file of output) {
  if (file.type === 'chunk') console.log(`  • bundled dist/${file.fileName} (${(file.code.length / 1024).toFixed(0)} kB)`);
}
