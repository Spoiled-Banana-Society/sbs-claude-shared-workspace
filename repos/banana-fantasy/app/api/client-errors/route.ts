import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { logErrorEvent } from '@/lib/errorEvents';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

// Client-side error reporting endpoint. The frontend can POST here to
// surface a runtime failure (WS auth fail, REST 5xx during draft, etc.)
// into the v2_error_events store, which powers the admin Server Errors
// tab and the notification badge. Also forwards to Sentry for grouping
// and root-cause exploration.
//
// Body: { source, message, route?, context?, stack? }
// All fields strings. Anything else is dropped to keep this tight.

interface ClientErrorBody {
  source?: unknown;
  message?: unknown;
  route?: unknown;
  context?: unknown;
  stack?: unknown;
  actor?: unknown;
}

function asString(v: unknown, max = 2000): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const body = (await req.json().catch(() => ({}))) as ClientErrorBody;
    const source = asString(body.source, 200);
    const message = asString(body.message, 2000);
    if (!source || !message) {
      return jsonError('source and message are required', 400, { requestId });
    }
    const route = asString(body.route, 500);
    const stack = asString(body.stack, 5000);
    const actor = asString(body.actor, 200);
    const context = asObject(body.context);

    logErrorEvent({
      source,
      message,
      route,
      stack,
      actor,
      context,
      requestId,
    });

    logger.info('client.error_reported', { requestId, source, route, actor });

    return json({ ok: true, requestId });
  } catch (err) {
    logger.error('client.error_endpoint.failed', { requestId, err });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
