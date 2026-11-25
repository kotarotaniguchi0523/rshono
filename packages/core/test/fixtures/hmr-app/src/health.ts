import type { Context } from 'hono';

export const handler = (c: Context) => c.json({ healthy: true });
