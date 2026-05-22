import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/error-export?sessionId=<id>
 *
 * Downloads a single JSON file containing every error in a debug
 * session plus that session's full breadcrumb trace — for handing
 * straight to a developer. No Firebase keys or CLI needed.
 *
 * Keyed on `sessionId` (not a doc id) so the export covers the whole
 * session, not just one error row. Uses single-field equality queries
 * only — no composite index required.
 */

// Matches the cap in scripts/inspect-debug-logs.mjs — a session with
// more events than this is pathological; the cap is the safety valve.
const MAX_TRACE = 2000;

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503, { requestId });

    const sessionId = (new URL(req.url).searchParams.get('sessionId') || '').trim().slice(0, 64);
    if (!sessionId) return jsonError('sessionId is required', 400, { requestId });

    const db = getAdminFirestore();

    // Single-field equality filters — auto-indexed, no composite index.
    // We sort in memory rather than .orderBy() to keep it index-free.
    const [errorSnap, traceSnap] = await Promise.all([
      db.collection('v2_error_events').where('sessionId', '==', sessionId).limit(500).get(),
      db.collection('v2_debug_events').where('sessionId', '==', sessionId).limit(MAX_TRACE).get(),
    ]);

    const errors = errorSnap.docs
      .map((d) => d.data())
      .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));

    const trace = traceSnap.docs
      .map((d) => d.data())
      .sort((a, b) => String(a.serverTs ?? '').localeCompare(String(b.serverTs ?? '')));

    const truncated = traceSnap.size >= MAX_TRACE;
    const note = trace.length === 0
      ? 'No breadcrumb trace found — it may have expired (24h TTL) or this session predates session linkage.'
      : undefined;

    const payload = {
      exportedAt: new Date().toISOString(),
      sessionId,
      counts: { errors: errors.length, traceEvents: trace.length },
      truncated,
      ...(note ? { note } : {}),
      errors,
      trace,
    };

    logger.info('admin.error_export.ok', {
      requestId, sessionId, errors: errors.length, trace: trace.length, durationMs: Date.now() - start,
    });

    const datePart = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="sbs-error-${sessionId}-${datePart}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error('admin.error_export.failed', { requestId, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
