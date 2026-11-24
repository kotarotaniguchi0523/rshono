import { Hono } from 'hono';

// The user sub-app: registered ahead of the page routes, so its middleware wraps pages, flight and actions.
const server = new Hono();

server.use('*', async (c, next) => {
  await next();
  c.header('x-fixture-middleware', 'ran');
});

server.get('/api/status', (c) => c.json({ ok: true }));

export default server;
