import { Suspense } from 'react';
import type { PageProps } from '@rsvhono/core';
import { notFound, redirect } from '@rsvhono/core/server';
import { gate } from '../gates';
import { Layout } from './layout';

/** Waits for the test, then asks the router to go somewhere else — long after the shell has been sent. */
async function Gated({ id, signal, to }: { id: string; signal: string | null; to: string }) {
  await gate(id).opened;
  if (signal === 'notfound') notFound();
  redirect(to);
  return null;
}

/**
 * `/gated-intent?gate=<id>&to=<path>` — a page whose shell is on screen, hydrated, while a section inside a
 * `<Suspense>` waits to raise `redirect(to)` (or `notFound()`, with `signal=notfound`) at a moment the test
 * picks. `&gate2=<id>&to2=<path>` adds a second section that redirects somewhere else, for what happens when
 * a page asks for two different things.
 *
 * It is the page being *left* in the tests that use it: the question is what its signal may still do then.
 */
export default function GatedIntent({ url }: PageProps) {
  const id = url.searchParams.get('gate') ?? 'default';
  const second = url.searchParams.get('gate2');
  return (
    <Layout title="Gated intent — rsvhono">
      <div className="page">
        <h1 data-gated-intent>Gated intent</h1>
        <a data-gated-go href="/users">
          /users
        </a>
        <Suspense fallback={<p data-gated="waiting">waiting for the gate…</p>}>
          <Gated id={id} signal={url.searchParams.get('signal')} to={url.searchParams.get('to') ?? '/login'} />
        </Suspense>
        {second && (
          <Suspense fallback={<p data-gated="waiting-2">waiting for the second gate…</p>}>
            <Gated id={second} signal={null} to={url.searchParams.get('to2') ?? '/dashboard'} />
          </Suspense>
        )}
      </div>
    </Layout>
  );
}
