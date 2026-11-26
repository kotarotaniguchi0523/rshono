import type { ReactNode } from 'react';
import { Link } from 'waku';
import '../styles.css';

/**
 * The shell every route shares. `<Link>` is Waku's client navigation — the counterpart to rsvhono's plain
 * `<a href>`, `next/link` and TanStack's `<Link>` in the other apps. Same user-visible behaviour, each
 * framework's idiomatic way of getting it.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <nav>
          <strong>Benchmark Suite</strong>
          <Link to="/">Home</Link>
          <Link to="/ssr">SSR</Link>
          <Link to="/interactive">Interactive</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <p>Waku — the minimal React framework.</p>
      </footer>
    </>
  );
}

export const getConfig = async () => ({ render: 'static' }) as const;
