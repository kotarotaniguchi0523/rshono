import type { PageProps } from '@rsvhono/core';
import { Counter } from '../components/counter';
import './home.css';

export default function Home({ url, ctx }: PageProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>vite app</title>
      </head>
      <body>
        <h1 data-page="home" className="home-title">
          Vite app
        </h1>
        <p data-url={url.href} data-query={url.searchParams.get('q') ?? '(none)'} />
        <p data-ctx-cookie={ctx.cookies.get('probe') ?? '(none)'} data-ctx-method={ctx.req.method} />
        {/* The RSC environment is server code: it reads the real environment, secrets included. */}
        <p data-server-secret={process.env.FIXTURE_SECRET ? 'present' : 'absent'} />
        <Counter />
        <a href="/items/7">item 7</a>
      </body>
    </html>
  );
}
