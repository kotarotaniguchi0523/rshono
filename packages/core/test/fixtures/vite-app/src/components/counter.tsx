'use client';

import { useActionState, useState } from 'react';
import { greet, shout } from '../actions';

export function Counter() {
  const [count, setCount] = useState(0);
  const [shouted, setShouted] = useState('');
  const [greeting, greetAction] = useActionState(greet, '');
  return (
    <section>
      <button data-testid="count" onClick={() => setCount((value) => value + 1)}>
        count: {count}
      </button>
      <button data-testid="shout" onClick={async () => setShouted(await shout('quiet'))}>
        shout
      </button>
      <output data-testid="shouted">{shouted}</output>
      <form action={greetAction}>
        <input name="name" defaultValue="vite" />
        <button data-testid="greet">greet</button>
      </form>
      <output data-testid="greeting">{greeting}</output>
      {/* Read on both sides of hydration: the SSR pass must see the same public-only view the browser does. */}
      <output data-testid="env" data-public={process.env.PUBLIC_FIXTURE ?? '(unset)'} data-secret={process.env.FIXTURE_SECRET ?? '(unset)'} />
    </section>
  );
}
