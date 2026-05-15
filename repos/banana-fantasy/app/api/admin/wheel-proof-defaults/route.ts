import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/wheel-proof-defaults
 *
 * Returns the VRF coordinator / subscription / keyHash already configured
 * for the existing draft BatchProof contract. The wheel uses the same
 * Chainlink VRF subscription, so pre-filling the wheel-proof deploy form
 * with these values makes it a one-click deploy.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const snap = await db.collection('system_config').doc('batchProof').get();
    if (!snap.exists) {
      return json({ found: false }, 200);
    }
    const cfg = snap.data() as {
      vrfCoordinator?: string;
      vrfSubscriptionId?: string;
      vrfKeyHash?: string;
      ownerAddress?: string;
    } | undefined;

    return json({
      found: true,
      vrfCoordinator: cfg?.vrfCoordinator ?? null,
      subscriptionId: cfg?.vrfSubscriptionId ?? null,
      keyHash: cfg?.vrfKeyHash ?? null,
      initialOwner: cfg?.ownerAddress ?? null,
    }, 200);
  } catch (err) {
    logger.error('admin.wheel_proof_defaults.failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
