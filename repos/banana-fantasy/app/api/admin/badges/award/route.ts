import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { unlockBadge } from '@/lib/db';
import { BADGE_BY_ID } from '@/lib/badges/catalog';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/badges/award
 * Body: { userId, badgeId, reason? }
 *
 * Admin-only. Manual grant for badges that need adjudication (BBB
 * Champion, HOF Champion, finals podium, founder-pick). Idempotent.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { walletAddress: adminWallet } = await requireAdmin(req);

    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const badgeId = requireString(body.badgeId, 'badgeId');
    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!BADGE_BY_ID[badgeId]) throw new ApiError(400, 'unknown badgeId');

    const changed = await unlockBadge(userId, badgeId, {
      grantedBy: adminWallet,
      reason: reason || 'admin grant',
    });
    return json({ ok: true, badgeId, userId, changed }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.badges.award.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
