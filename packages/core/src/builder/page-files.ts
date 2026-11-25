/**
 * Finds the page modules named by inline `component: () => import('…')` thunks in `routes.ts`, so the page
 * transform wraps exactly those files. A page wired up any other way declares its `'use server-entry'`
 * directive itself.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizePath } from 'vite';

const COMPONENT_THUNK = /component:\s*(?:async\s*)?\(\s*\)\s*=>\s*import\(\s*(['"])([^'"]+)\1\s*\)/g;

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

function resolveCandidates(base: string): string[] {
  return [...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => join(base, `index${ext}`)), base];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function scanPageFiles(routesFile: string, srcDir: string, into: Set<string>): void {
  into.clear();
  let source: string;
  try {
    source = readFileSync(routesFile, 'utf8');
  } catch {
    return;
  }
  for (const match of source.matchAll(COMPONENT_THUNK)) {
    const spec = match[2];
    let base: string | undefined;
    if (spec.startsWith('.')) base = resolve(dirname(routesFile), spec);
    else if (spec.startsWith('@/')) base = resolve(srcDir, spec.slice(2));
    if (!base) continue;
    for (const candidate of resolveCandidates(base)) {
      if (isFile(candidate)) {
        // As Vite spells a module id: forward slashes on every platform, which `node:path` does not give on Windows.
        into.add(normalizePath(candidate));
        break;
      }
    }
  }
}
