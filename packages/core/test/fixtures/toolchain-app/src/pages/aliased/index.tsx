import './aliased.css';

export default function Aliased() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>aliased page</title>
      </head>
      <body>
        <h1 data-page="aliased" className="aliased-title">
          Reached through an alias
        </h1>
      </body>
    </html>
  );
}
