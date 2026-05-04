import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { getPersonaVerification, savePersonaVerification } from '@/lib/db-firestore';

type Tier = 'tier1' | 'tier2';

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
    const tierRaw = typeof body.tier === 'string' ? body.tier : 'tier1';
    const verified = body.verified !== false; // default true

    if (!userId) throw new ApiError(400, 'Missing userId');
    if (tierRaw !== 'tier1' && tierRaw !== 'tier2') {
      throw new ApiError(400, 'tier must be tier1 or tier2');
    }
    const tier: Tier = tierRaw;

    const before = await getPersonaVerification(userId);

    const tierData: { verified: boolean; inquiryId?: string; verifiedAt?: string } = { verified };
    if (verified) {
      tierData.inquiryId = 'admin-override';
      tierData.verifiedAt = new Date().toISOString();
    }
    await savePersonaVerification(userId, { [tier]: tierData });

    const after = await getPersonaVerification(userId);

    await logAdminAction({
      actor: actorWallet,
      action: verified ? 'kyc-verify' : 'kyc-revoke',
      target: userId,
      before: { [tier]: before[tier] },
      after: { [tier]: after[tier] },
      requestId,
    });

    logger.info('admin.kyc_verify.ok', {
      requestId,
      actor: actorWallet,
      target: userId,
      tier,
      verified,
      durationMs: Date.now() - start,
    });

    return json({ success: true, userId, tier, verified, requestId });
  } catch (err) {
    logger.error('admin.kyc_verify.failed', {
      requestId,
      actor: actorWallet,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
