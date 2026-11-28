// What a build's file names depend on. A visitor keeps a chunk for as long as its name is the same, so a
// name that changes when the source did not is a download for nothing — and the build id, new on every
// `rsvhono build`, was exactly that: inlined into the browser bundle, it renamed the chunk it landed in (the
// one with React) and every chunk importing it. On the testbed that was 20 of 23 files, 95% of the bytes,
// on a rebuild of unchanged source. The id now reaches the browser through the document instead.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { buildApp, runCli, startApp, stopServer, TOOLCHAIN_APP_DIR } from './helpers.mjs';

const dist = join(TOOLCHAIN_APP_DIR, 'dist');

/** The browser's files after a build: name → content hash, plus the id that build gave itself. */
function snapshot() {
  buildApp(TOOLCHAIN_APP_DIR);
  const dir = join(dist, 'static', 'assets');
  const sources = Object.fromEntries(readdirSync(dir).map((file) => [file, readFileSync(join(dir, file), 'utf8')]));
  const hashes = Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')]));
  const { buildId } = JSON.parse(readFileSync(join(dist, 'rsvhono-build.json'), 'utf8'));
  const server = readFileSync(join(dist, 'server', 'main.mjs'), 'utf8');
  return { sources, hashes, buildId, server };
}

describe('two builds of the same source', () => {
  const first = snapshot();
  const second = snapshot();

  test('are two builds: each has its own id', () => {
    assert.match(first.buildId, /^[0-9a-f]{16}$/);
    assert.notEqual(first.buildId, second.buildId);
  });

  test('give the browser the same files under the same names', () => {
    assert.deepEqual(Object.keys(second.hashes).sort(), Object.keys(first.hashes).sort(), 'no chunk was renamed');
    assert.deepEqual(second.hashes, first.hashes, 'and none changed under its name');
  });

  test('because no browser file contains the id', () => {
    for (const [file, source] of Object.entries(second.sources)) assert.ok(!source.includes(second.buildId), `${file} carries no copy of it`);
  });

  test('while the server bundle does, which is what makes it this build', () => {
    assert.ok(second.server.includes(second.buildId));
    assert.ok(!second.server.includes(first.buildId));
  });
});

describe('how the browser learns the id', async () => {
  const { buildId } = snapshot();
  const { base, child } = await startApp(TOOLCHAIN_APP_DIR, 'start');
  after(() => stopServer(child));
  const res = await fetch(`${base}/`);
  const html = await res.text();

  test('the document says it, in the script React writes ahead of the entry', () => {
    const inline = /<script[^>]*>(self\.__rsvhonoBuild="[^"]*";[^<]*)<\/script>/.exec(html);
    assert.ok(inline, 'the bootstrap script sets the global');
    assert.ok(inline[1].startsWith(`self.__rsvhonoBuild="${buildId}";`));
    const entry = html.indexOf('<script type="module"');
    assert.ok(entry === -1 || inline.index < entry, 'before the module that reads it');
    assert.ok(html.indexOf('rsvhono:chunk-reload') > inline.index, 'in the same script as the chunk recovery preamble');
  });

  test('and it is the id the response header carries', () => {
    assert.equal(res.headers.get('x-rsvhono-build'), buildId);
  });
});

describe('build.chunkImportMap', () => {
  // Measured before refusing it (docs/upstream-audit.md): for the client environment alone it works as
  // advertised — one edited component renames one file instead of twenty — but the names it writes into the
  // bundle resolve only through an import map in the document, which this framework does not emit.
  for (const scope of ['client', 'all']) {
    test(`is refused when set for ${scope === 'all' ? 'every environment' : 'the client environment'}`, () => {
      const { status, output } = runCli(TOOLCHAIN_APP_DIR, ['build'], { env: { FIXTURE_IMPORT_MAP: scope } });
      assert.notEqual(status, 0, 'a build whose pages could not boot does not exit clean');
      assert.match(output, /`build\.chunkImportMap` is on for the \w+ environment/);
      assert.match(output, /does not put an import map in the\s+document/);
    });
  }
});
