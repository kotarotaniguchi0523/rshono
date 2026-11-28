import { Suspense } from 'react';

async function Late() {
  await new Promise((done) => setTimeout(done, 150));
  return <p data-late="arrived">late content</p>;
}

export default function Slow() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>slow</title>
      </head>
      <body>
        <h1 data-page="slow">Slow</h1>
        <Suspense fallback={<p data-late="pending">waiting</p>}>
          <Late />
        </Suspense>
      </body>
    </html>
  );
}
