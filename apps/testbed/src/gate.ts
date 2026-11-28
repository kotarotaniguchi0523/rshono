import type { Handler } from 'hono';
import { gate } from './gates';

/** `POST /api/gate?id=<id>` — lets the render waiting on that gate carry on. */
export const handler: Handler = (c) => {
  gate(c.req.query('id') ?? '').open();
  return c.json({ opened: true });
};
