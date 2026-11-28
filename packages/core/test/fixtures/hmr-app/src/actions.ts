'use server';

let greetings = 0;

/** Called from the client with plain arguments — the `x-rsc-action` path. */
export async function shout(text: string): Promise<string> {
  return text.toUpperCase();
}

/** Driven through `useActionState`, so it also works as a no-JS form post. */
export async function greet(_previous: string, formData: FormData): Promise<string> {
  greetings += 1;
  return `hello ${String(formData.get('name'))} #${greetings}`;
}

export async function fail(): Promise<never> {
  throw new Error('fixture action failure');
}
