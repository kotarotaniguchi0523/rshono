import type { ReactNode } from 'react';

/** The document. Waku splits it from the layout: this is the part no route changes. */
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}

export const getConfig = async () => ({ render: 'static' }) as const;
