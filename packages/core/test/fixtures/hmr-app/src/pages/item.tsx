import type { PageProps } from '@rshono/core';
import { Counter } from '../components/counter';

export default function Item({ params }: PageProps<'/items/:id'>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>item</title>
      </head>
      <body>
        <h1 data-page="item" data-id={params.id}>
          Item {params.id}
        </h1>
        <Counter />
        <a href="/">home</a>
      </body>
    </html>
  );
}
