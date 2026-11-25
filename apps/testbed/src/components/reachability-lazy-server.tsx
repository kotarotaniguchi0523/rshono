import { reachLazyServer } from '../reach/lazy-server';

/** A server component loaded with `import()`, holding a form whose action only it refers to. */
export function ReachabilityLazyServer() {
  return (
    <form action={reachLazyServer} data-reach="lazy-server">
      <button type="submit">lazy server</button>
    </form>
  );
}
