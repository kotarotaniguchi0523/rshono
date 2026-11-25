import { Board } from '../components/board';

export default function Home() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>toolchain app</title>
      </head>
      <body>
        <h1 data-page="home">Toolchain app</h1>
        <Board />
      </body>
    </html>
  );
}
