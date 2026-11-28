import { Counter } from './counter';
import { Layout } from './layout';
import { RouteIndex } from './route-index';

export default function Home() {
  return (
    <Layout title="rsvhono — testbed">
      <RouteIndex />
      <Counter />
    </Layout>
  );
}
