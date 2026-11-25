'use server';

/** Imported by a client component through a re-export. */
export async function reachBarrel(): Promise<string> {
  return 'barrel';
}
