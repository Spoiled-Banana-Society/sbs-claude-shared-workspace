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
 * Clears ephemeral state on a user so Boris can re-run onboarding/buy/wheel flows
 * end-to-end without hand-editing Firestore. Does NOT delete the user, wallet link,
 * referral code, or historical purchases — only the counters that gate UI flows.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
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
    // 'promos' = balance-safe: clears ONLY the promo-gating flags so the
    // first-purchase / wheel flow can be re-tested without wiping passes,
    // free drafts, spins, JP/HOF. 'all' (default) = full counter reset.
    const scope = body.scope === 'promos' ? 'promos' : 'all';

    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const snap = await userRef.get();
    if (!snap.exists) throw new ApiError(404, `User not found: ${userId}`);

    const data = snap.data() ?? {};
    const before = {
      draftPasses: data.draftPasses ?? 0,
      freeDrafts: data.freeDrafts ?? 0,
      wheelSpins: data.wheelSpins ?? 0,
      cardPurchaseCount: data.cardPurchaseCount ?? 0,
      cardFeeCreditCents: data.cardFeeCreditCents ?? 0,
      jackpotEntries: data.jackpotEntries ?? 0,
      hofEntries: data.hofEntries ?? 0,
      // Onboarding/promo gate flags — must reset too so the new-user flow
      // (spin text → free drafts → first-purchase card/popup) can re-run.
      hasSpunWheel: data.hasSpunWheel ?? false,
      firstPurchaseBonusGranted: data.firstPurchaseBonusGranted ?? false,
      firstPurchasePromoUnlocked: data.firstPurchasePromoUnlocked ?? false,
      pendingWheelWinnings: data.pendingWheelWinnings ?? 0,
    };

    const PROMO_FLAGS = {
      hasSpunWheel: false,
      firstPurchaseBonusGranted: false,
      firstPurchasePromoUnlocked: false,
    };
    const cleared = scope === 'promos'
      ? PROMO_FLAGS
      : {
          draftPasses: 0,
          freeDrafts: 0,
          wheelSpins: 0,
          cardPurchaseCount: 0,
          cardFeeCreditCents: 0,
          jackpotEntries: 0,
          hofEntries: 0,
          pendingWheelWinnings: 0,
          ...PROMO_FLAGS,
        };

    await userRef.set(cleared, { merge: true });

    // Re-enable the New User promo for re-testing: clear newUserPromoClaimed on
    // the linked X account. Without this the promo stays claimed-forever (the
    // box never reappears) even after the user-doc flags are reset, because the
    // X-link doc is the source of truth for the new-user claim.
    let twitterPromoReset = false;
    try {
      const linkSnap = await db
        .collection('v2_twitter_links')
        .where('walletAddress', '==', userId.toLowerCase())
        .limit(1)
        .get();
      if (!linkSnap.empty) {
        await linkSnap.docs[0].ref.update({ newUserPromoClaimed: false });
        twitterPromoReset = true;
      }
    } catch (e) {
      logger.warn('admin.reset_user.twitter_clear_failed', {
        requestId, target: userId, err: e instanceof Error ? e.message : String(e),
      });
    }

    await logAdminAction({
      actor: actorWallet,
      action: 'reset-user',
      target: userId,
      before,
      after: cleared,
      requestId,
    });

    logger.info('admin.reset_user.ok', {
      requestId,
      actor: actorWallet,
      target: userId,
      before,
      durationMs: Date.now() - start,
    });

    return json({ success: true, userId, scope, before, twitterPromoReset, requestId });
  } catch (err) {
    logger.error('admin.reset_user.failed', {
      requestId,
      actor: actorWallet,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
