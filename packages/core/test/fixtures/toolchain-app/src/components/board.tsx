'use client';

import { useState } from 'react';
import { Alpha } from 'fixture-icons';
import { noteExpensiveRender } from './render-log';

interface Item {
  id: string;
}

function Expensive({ items }: { items: Item[] }) {
  noteExpensiveRender();
  return (
    <ul data-expensive>
      {items.map((item) => (
        <li key={item.id}>{item.id}</li>
      ))}
    </ul>
  );
}

/**
 * Written the way React Compiler exists to fix: `items` is a new array on every render, so `Expensive`
 * re-renders whenever the count changes although nothing it shows has. Compiled, the array and the element
 * are cached and it renders once.
 */
export function Board() {
  const [count, setCount] = useState(0);
  const items = ['a', 'b', 'c'].map((id) => ({ id }));
  return (
    <section data-board data-icon={Alpha()}>
      <button data-bump onClick={() => setCount(count + 1)}>
        bumped {count}
      </button>
      <Expensive items={items} />
    </section>
  );
}
