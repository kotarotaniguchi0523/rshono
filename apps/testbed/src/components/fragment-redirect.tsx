import type { PageProps } from '@rsvhono/core';
import { redirect } from '@rsvhono/core/server';
import { Layout } from './layout';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Redirects whose target differs from the URL navigated to *in its fragment*. Where a navigation scrolls to
 * is decided by the URL it ends on, and a redirect is how those two come apart:
 *
 *   ?case=add      → /fragment-redirect/target#low      a fragment where the request had none
 *   ?case=change   → /fragment-redirect/target#low      whatever fragment the request carried, replaced
 *   ?case=remove   → /fragment-redirect/target          the request's fragment dropped
 *   ?case=twice    → ?case=add                          two hops before the answer
 *   ?case=slow     → as `add`, after 600ms              long enough to navigate elsewhere meanwhile
 *
 * Thrown from the page component itself, a redirect is known before anything is sent, and the browser
 * resolves it before committing a URL. With `&late=1` it is thrown by a child that suspends first — after
 * the payload has started — and the browser can only follow it as a document load. Both end on the same URL.
 */
function redirectFor(which: string | null): void {
  if (which === 'add' || which === 'change' || which === 'slow') redirect('/fragment-redirect/target#low');
  if (which === 'remove') redirect('/fragment-redirect/target');
  if (which === 'twice') redirect('/fragment-redirect/from?case=add');
}

async function Late({ which, ms }: { which: string | null; ms: number }) {
  await sleep(ms);
  redirectFor(which);
  return null;
}

export default function FragmentRedirect({ url, params }: PageProps<'/fragment-redirect/:step'>) {
  const which = url.searchParams.get('case');
  const late = url.searchParams.has('late') || which === 'slow';
  if (params.step === 'from' && !late) redirectFor(which);
  return (
    <Layout title="Fragment redirect — rsvhono">
      <div className="page" data-fragment-page={params.step}>
        <h1>Fragment redirect: {params.step}</h1>
        {params.step === 'from' && late && <Late which={which} ms={which === 'slow' ? 600 : 20} />}
        {/* Tall enough that each anchor is a different scroll position, and that neither is the top. */}
        <div style={{ height: '1600px' }} />
        <h2 id="high">high</h2>
        <div style={{ height: '1600px' }} />
        <h2 id="low">low</h2>
        <div style={{ height: '1600px' }} />
      </div>
    </Layout>
  );
}
