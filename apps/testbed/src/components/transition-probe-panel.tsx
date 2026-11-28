'use client';

import { Suspense, use, useActionState, useState, useTransition } from 'react';
import { probeEcho } from '../actions';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const lookups = new Map<number, Promise<number>>();
/** A value that takes 300ms to arrive, once per key — what the Suspense probe reads with `use`. */
function lookup(key: number): Promise<number> {
  let pending = lookups.get(key);
  if (!pending) lookups.set(key, (pending = sleep(key === 0 ? 0 : 300).then(() => key)));
  return pending;
}

function Looked({ lookupKey }: { lookupKey: number }) {
  return <output data-probe="suspense">{use(lookup(lookupKey))}</output>;
}

/**
 * Four ways a client component changes its own state, each independent of the router, so a test can ask of
 * each one: does it commit while a navigation is still pending — and does a navigation commit while it is?
 * Written against React alone; the same file runs under another framework to tell React's behaviour from
 * this one's. See `packages/core/docs/react-transitions.md`.
 */
export function TransitionProbePanel() {
  const [count, setCount] = useState(0);
  const [, startBump] = useTransition();

  const [asyncDone, setAsyncDone] = useState(0);
  const [asyncPending, startAsync] = useTransition();

  const [lookupKey, setLookupKey] = useState(0);
  const [, startLookup] = useTransition();

  const [echo, echoAction, echoPending] = useActionState(probeEcho, 0);

  return (
    <div data-probe-panel>
      <button data-probe-do="sync" onClick={() => startBump(() => setCount((value) => value + 1))}>
        transition
      </button>
      <output data-probe="sync">{count}</output>

      <button
        data-probe-do="async"
        onClick={(event) => {
          const ms = Number(event.currentTarget.dataset.ms ?? 300);
          startAsync(async () => {
            await sleep(ms);
            startAsync(() => setAsyncDone((value) => value + 1));
          });
        }}
      >
        async transition
      </button>
      <output data-probe="async">{asyncDone}</output>
      <output data-probe="async-pending">{String(asyncPending)}</output>

      <button data-probe-do="suspense" onClick={() => startLookup(() => setLookupKey((value) => value + 1))}>
        suspending transition
      </button>
      <Suspense fallback={<output data-probe="suspense">…</output>}>
        <Looked lookupKey={lookupKey} />
      </Suspense>

      <form action={echoAction}>
        <input type="hidden" name="ms" defaultValue="300" data-probe-action-ms />
        <button data-probe-do="action" type="submit">
          action
        </button>
      </form>
      <output data-probe="action">{echo}</output>
      <output data-probe="action-pending">{String(echoPending)}</output>
    </div>
  );
}
