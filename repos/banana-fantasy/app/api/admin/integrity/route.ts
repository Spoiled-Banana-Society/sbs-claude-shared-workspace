import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logErrorEvent } from '@/lib/errorEvents';
import { runAllAudits } from '@/lib/audits/checks';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

/**
 * GET /api/admin/integrity        → run all state-integrity audits, return findings.
 * GET /api/admin/integrity?post=1 → also write each finding into v2_error_events
 *                                   so it shows in the admin Logs feed (tiered by
 *                                   severity). The daily cron uses post=1.
 *
 * Audits the money/fairness invariants that can silently drift (pass counter vs
 * real spendable tokens, negative balances). See lib/audits/checks.ts.
 */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    const post = new URL(req.url).searchParams.get('post') === '1';
    const db = getAdminFirestore();
    const { findings, summary } = await runAllAudits(db);

    if (post) {
      for (const f of findings) {
        await logErrorEvent({
          source: f.source,
          route: '/api/admin/integrity',
          message: f.message,
          actor: f.actor,
          context: f.context,
        });
      }
    }

    logger.info('admin.integrity.ran', { requestId, ...summary, posted: post });
    return json({ summary, findings, posted: post, requestId });
  } catch (err) {
    logger.error('admin.integrity.failed', { requestId, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
