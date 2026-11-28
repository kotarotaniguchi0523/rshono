'use server';

/** Imported by a client component that is itself loaded with `import()`. */
export async function reachLazyClient(): Promise<string> {
  return 'lazy-client';
}
