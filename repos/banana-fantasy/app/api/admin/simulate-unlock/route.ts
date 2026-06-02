import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';

const USERS_COLLECTION = 'v2_users';

/**
 * Testing helper: simulate a brand-new user finishing their welcome free drafts
 * by flipping `firstPurchasePromoUnlocked = true` — no balance change. Lets an
 * admin see the new-user first-purchase "unlock moment" (card + NEW badge +
 * popup + banner) on demand without actually grinding through free drafts.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const body = await parseBody(req);
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) throw new ApiError(400, 'Missing userId');

    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const snap = await userRef.get();
    if (!snap.exists) throw new ApiError(404, `User not found: ${userId}`);

    await userRef.set({ firstPurchasePromoUnlocked: true }, { merge: true });

    await logAdminAction({
      actor: actorWallet,
      action: 'reset-user', // reuse a valid audit action; details below
      target: userId,
      before: { firstPurchasePromoUnlocked: !!snap.data()?.firstPurchasePromoUnlocked },
      after: { firstPurchasePromoUnlocked: true, note: 'simulate-unlock' },
      requestId,
    });
    logger.info('admin.simulate_unlock.ok', { requestId, actor: actorWallet, target: userId });

    return json({ success: true, userId, firstPurchasePromoUnlocked: true, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.simulate_unlock.failed', { requestId, actor: actorWallet, err });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
