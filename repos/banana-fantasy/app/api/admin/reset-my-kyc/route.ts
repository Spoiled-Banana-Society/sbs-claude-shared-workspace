// Self-service KYC reset for admins ONLY. Lets an admin wipe their own
// tier1/tier2 verification + verifiedIdentity so they can re-run the full
// verification flow for testing — without needing to call the existing
// admin endpoint with their own userId (which they'd have to look up).
//
// This is a TESTING utility. Production users should never hit this — it's
// gated on isWalletAdmin so only the admin allowlist can trigger it.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { getPersonaVerification, savePersonaVerification } from '@/lib/db-firestore';

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

    const before = await getPersonaVerification(admin.userId);

    // Reset tier1 + tier2. verifiedIdentity stays in the doc but is harmless
    // (the cashout flow gates on tier1.verified, which is now false → it'll
    // re-trigger verification → next submit overwrites verifiedIdentity).
    // cumulativeWithdrawals intentionally left alone.
    await savePersonaVerification(admin.userId, {
      tier1: { verified: false },
      tier2: { verified: false },
    });

    const after = await getPersonaVerification(admin.userId);

    await logAdminAction({
      actor: actorWallet,
      action: 'kyc-revoke',
      target: admin.userId,
      before: { tier1: before.tier1, tier2: before.tier2 },
      after: { tier1: after.tier1, tier2: after.tier2 },
      requestId,
    });

    logger.info('admin.kyc_self_reset.ok', {
      requestId,
      actor: actorWallet,
      durationMs: Date.now() - start,
    });

    return json({ success: true, userId: admin.userId, requestId });
  } catch (err) {
    logger.error('admin.kyc_self_reset.failed', {
      requestId,
      actor: actorWallet,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
