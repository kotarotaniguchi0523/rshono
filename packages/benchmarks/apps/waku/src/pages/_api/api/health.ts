/** APP_SPEC.md: no React on this path at all — router and response construction only. Served at `/api/health`. */
export const GET = async (): Promise<Response> => Response.json({ ok: true, route: 'health' });
