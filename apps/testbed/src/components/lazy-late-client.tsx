'use client';

import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { probeEcho } from '../actions';

const Panel = lazy(() => import('./lazy-late-panel'));

/** An app's own error boundary, the kind that would otherwise leave a missing chunk as a fallback forever. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p data-lazy-late-caught>the panel could not be loaded</p> : this.props.children;
  }
}

/**
 * A chunk that is asked for long after the page has hydrated — on a click. `bounded` puts the app's own
 * error boundary around it; without one a failed import takes the root down.
 */
export function LazyLateClient({ bounded }: { bounded: boolean }) {
  const [open, setOpen] = useState(false);
  const [echoed, setEchoed] = useState('');
  const panel = open ? (
    <Suspense fallback={<p data-lazy-late-loading>loading…</p>}>
      <Panel />
    </Suspense>
  ) : null;
  return (
    <div data-lazy-late-ready>
      <button data-lazy-late-open onClick={() => setOpen(true)}>
        open the lazy panel
      </button>
      {/* A server function call from the same page, for the test that sets a build mismatch against a missing chunk. */}
      <button
        data-lazy-late-call
        onClick={() =>
          void probeEcho(0, new FormData()).then(
            (value) => setEchoed(`ok ${value}`),
            (error: unknown) => setEchoed(`failed ${(error as { code?: string }).code ?? 'error'}`),
          )
        }
      >
        call a server function
      </button>
      <output data-lazy-late-called>{echoed}</output>
      {bounded ? <Boundary>{panel}</Boundary> : panel}
    </div>
  );
}
