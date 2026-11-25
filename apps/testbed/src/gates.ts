/**
 * Promises a test opens from outside: `/gated-intent` waits on one, and `POST /api/gate?id=…` resolves it.
 * That is how a browser test decides *when* a server component — already streaming — raises its signal.
 */
const gates = new Map<string, { opened: Promise<void>; open: () => void }>();

export function gate(id: string): { opened: Promise<void>; open: () => void } {
  let found = gates.get(id);
  if (!found) {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    gates.set(id, (found = { opened, open }));
    // Never left waiting for a test that died: a render parked here would hold its response open for good.
    setTimeout(open, 20_000).unref?.();
  }
  return found;
}
