import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { backfillUsernameLower } from '@/lib/usernameBackfill';

/**
 * POST /api/admin/backfill-username-lower
 *
 * On-demand admin trigger for the username_lower backfill. The same
 * routine runs nightly via Vercel cron (app/api/crons/backfill-username-lower).
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    const admin = await requireAdmin(req);
    const actorWallet = admin.walletAddress ?? admin.userId;
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const result = await backfillUsernameLower();
    logger.info('admin.backfill-username-lower.done', { actorWallet, ...result });
    return json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('admin.backfill-username-lower.failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
