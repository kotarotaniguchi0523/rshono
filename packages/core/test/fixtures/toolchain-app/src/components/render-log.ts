// Counts renders where a test can read them. Outside the component file on purpose: a component that
// writes a module variable during render is one React Compiler declines to compile.
declare global {
  var __expensiveRenders: number | undefined;
}

export function noteExpensiveRender(): void {
  globalThis.__expensiveRenders = (globalThis.__expensiveRenders ?? 0) + 1;
}
