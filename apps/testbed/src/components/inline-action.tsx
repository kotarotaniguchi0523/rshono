import type { PageProps } from '@rsvhono/core';
import { getRequestContext } from '@rsvhono/core/server';
import { Layout } from './layout';

/** Captured by the inline function below. It must reach the browser encrypted, or not at all. */
const CLOSURE_MARK = 'inline-closure-7f3a91';

/**
 * A server function declared *inside* a server component, closing over a value from the render. The bundler
 * hoists it and binds what it captured as an encrypted argument, so the form carries the closure without
 * showing it — and the hoisted function still has to be one the build's allowlist knows.
 */
export default function InlineAction({ ctx }: PageProps<'/inline-action'>) {
  const captured = `${CLOSURE_MARK}:${ctx.url.pathname}`;
  const stamped = ctx.cookies.get('stamped');

  async function stamp(formData: FormData) {
    'use server';
    const note = formData.get('note');
    getRequestContext().cookies.set('stamped', `${captured}:${typeof note === 'string' ? note.slice(0, 40) : ''}`, { path: '/', httpOnly: true });
  }

  return (
    <Layout title="Inline action — rsvhono">
      <div className="page">
        <h1>Inline action</h1>
        {stamped && <p data-stamped>{stamped}</p>}
        <form action={stamp} className="form">
          <label>
            Note
            <input name="note" placeholder="anything" />
          </label>
          <button className="btn" type="submit">
            Stamp
          </button>
        </form>
      </div>
    </Layout>
  );
}
