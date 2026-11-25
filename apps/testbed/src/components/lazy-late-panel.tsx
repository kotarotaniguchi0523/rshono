'use client';

/** The chunk `lazy-late` imports on a click. Its own file so that it is its own request, which a test can fail. */
export default function LazyLatePanel() {
  return <p data-lazy-late-panel>lazy panel loaded</p>;
}
