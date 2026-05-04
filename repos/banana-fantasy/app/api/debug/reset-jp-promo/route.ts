import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import type { Promo } from '@/types';

/**
 * POST /api/debug/reset-jp-promo
 *
 * Staging-only. Reverts the jackpot-hit promo state on a user's record
 * so they can replay the winner-picker animation. If `draftId` is
 * supplied, only that history entry is removed; otherwise the entire
 * JP promo is reset to its seeded shape.
 *
 * Body: { userId: string, draftId?: string }
 */
const JACKPOT_HIT_PROMO_ID = '4';
const USERS_COLLECTION = 'v2_users';
const PROMOS_SUBCOLLECTION = 'promos';

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT !== 'staging') {
    return jsonError('Forbidden — staging only', 403);
  }

  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!isFirestoreConfigured()) {
      throw new ApiError(503, 'Firestore not configured');
    }
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId').toLowerCase();
    const draftId = typeof body.draftId === 'string' && body.draftId.trim() ? body.draftId.trim() : null;

    const db = getAdminFirestore();
    const promoRef = db
      .collection(USERS_COLLECTION)
      .doc(userId)
      .collection(PROMOS_SUBCOLLECTION)
      .doc(JACKPOT_HIT_PROMO_ID);

    const before = (await promoRef.get()).data() as Promo | undefined;
    if (!before) {
      throw new ApiError(404, 'JP promo doc not found for this user');
    }

    let after: Promo;
    if (draftId) {
      // Remove just this draft's history entry, keep the rest.
      const history = (before.modalContent.jackpotHistory ?? []).filter(
        (h) => h.draftName !== draftId,
      );
      const removed = (before.modalContent.jackpotHistory ?? []).filter(
        (h) => h.draftName === draftId,
      );
      const removedSpins = removed.reduce((sum, h) => sum + (h.amount ?? 0), 0);
      after = {
        ...before,
        modalContent: { ...before.modalContent, jackpotHistory: history },
        claimCount: Math.max(0, (before.claimCount ?? 0) - removedSpins),
        claimable: history.length > 0 ? before.claimable : false,
        progressCurrent: history.length > 0 ? (before.progressCurrent ?? 0) : 0,
      };
    } else {
      after = {
        ...before,
        modalContent: { ...before.modalContent, jackpotHistory: [] },
        claimCount: 0,
        claimable: false,
        progressCurrent: 0,
      };
    }

    await promoRef.set(after);
    logger.info('debug.reset_jp_promo', { userId, draftId, before, after });
    return json({ success: true, userId, draftId, before, after }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('debug.reset_jp_promo.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
