import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { dedupeUsernames } from '@/lib/usernameDedupe';

/**
 * POST /api/admin/dedupe-usernames        → DRY RUN (writes nothing; returns the plan)
 * POST /api/admin/dedupe-usernames?apply=1 → applies the renames + seeds reservations
 *
 * One-time migration to make all existing usernames unique. Safe to re-run
 * (idempotent). Admin-only.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    const admin = await requireAdmin(req);
    const actorWallet = admin.walletAddress ?? admin.userId;
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const apply = ['1', 'true', 'yes'].includes((new URL(req.url).searchParams.get('apply') || '').toLowerCase());
    const result = await dedupeUsernames(apply, Date.now());
    logger.info('admin.dedupe-usernames.done', {
      actorWallet, apply, collidingNames: result.collidingNames, renamed: result.renamed,
    });
    return json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('admin.dedupe-usernames.failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
