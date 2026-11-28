'use server';

/** Referred to by a server component, as a form's action. */
export async function reachDirect(_formData: FormData): Promise<void> {
  // The body of a server function is the server's. This string must not be in anything the browser is sent.
  console.log('__server_function_body__');
}
