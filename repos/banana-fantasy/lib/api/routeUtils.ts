import { NextResponse } from 'next/server';
import { ApiError } from './errors';

export function json(data: unknown, init?: number | ResponseInit) {
  const responseInit: ResponseInit = typeof init === 'number' ? { status: init } : (init ?? {});
  return NextResponse.json(data, responseInit);
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ error: message, ...(extra ?? {}) }, status);
}

export async function parseBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `Missing or invalid field: ${field}`);
  }
  return value.trim();
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApiError(400, `Missing or invalid field: ${field}`);
  }
  return value;
}

export function getSearchParam(req: Request, key: string): string | null {
  const url = new URL(req.url);
  return url.searchParams.get(key);
}

type RouteCtx = unknown;
type RouteHandler = (req: Request, ctx: RouteCtx) => Promise<Response> | Response;

/**
 * Wrap an API route handler so any UNEXPECTED error (a real 500) is logged to
 * the admin Logs feed (v2_error_events) with a `<routeName>.unhandled` source —
 * which the notify list already badges via the `/\.unhandled$/i` pattern.
 *
 * Expected `ApiError` (4xx the handler intentionally threw) passes through
 * unlogged. A handler that builds + returns its own 500 Response is passed
 * through untouched (so this never double-logs routes with inner catches).
 *
 * The Firestore write is AWAITED before responding — required on Vercel, where
 * a fire-and-forget write is dropped when the function returns.
 *
 * Usage: `export const POST = withRouteLogging('payment.card_mint', async (req) => { … })`
 */
export function withRouteLogging(routeName: string, handler: RouteHandler): RouteHandler {
  return async (req: Request, ctx: RouteCtx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.message, err.status);
      let pathname = '';
      let actor: string | undefined;
      try {
        const url = new URL(req.url);
        pathname = url.pathname;
        // Best-effort affected-user: a 0x wallet in the path (many routes are
        // /api/.../{wallet}/...). Body isn't read here — that'd consume the
        // stream the handler needs.
        actor = pathname.match(/0x[a-fA-F0-9]{40}/)?.[0]?.toLowerCase();
      } catch { /* ignore */ }
      try {
        const { logErrorEvent } = await import('@/lib/errorEvents');
        await logErrorEvent({
          source: `${routeName}.unhandled`,
          message: err instanceof Error ? err.message : String(err),
          route: pathname,
          actor,
          stack: err instanceof Error ? err.stack : undefined,
        });
      } catch { /* logging must never mask the original failure */ }
      return jsonError('Internal Server Error', 500);
    }
  };
}
