import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';

const ALLOWED_VARIANTS = new Set([
  'commit-reveal',
  'vrf',
  'vrf-commit',
  'vrf-commit-merkle',
]);

/**
 * POST /api/admin/batch-proof-variant
 *   { variant: 'vrf-commit' | 'vrf-commit-merkle' | ... }
 *
 * Flips system_config/batchProof.contractVariant. The Go API picks up
 * the new variant on its next boot — running instances continue with
 * whatever variant they booted with. So after flipping, you typically
 * want to redeploy the Go API to pick up the new value.
 *
 * For vrf-commit-merkle specifically, the Go API also needs the
 * merkleClient attached (auto-happens when system_config/batchProofMerkle
 * is present at boot).
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req);
    const variant = typeof body.variant === 'string' ? body.variant.trim() : '';
    if (!ALLOWED_VARIANTS.has(variant)) {
      throw new ApiError(400, `variant must be one of: ${Array.from(ALLOWED_VARIANTS).join(', ')}`);
    }

    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');
    const db = getAdminFirestore();

    const snap = await db.collection('system_config').doc('batchProof').get();
    if (!snap.exists) {
      throw new ApiError(404, 'system_config/batchProof not found — deploy the batch proof contract first');
    }
    const before = snap.data() as { contractVariant?: string } | undefined;
    const previousVariant = before?.contractVariant ?? '(unset)';

    await db.collection('system_config').doc('batchProof').set(
      { contractVariant: variant },
      { merge: true },
    );

    await logAdminAction({
      actor: actorWallet,
      action: 'deploy-batch-proof', // existing action label, generic enough
      target: 'system_config/batchProof',
      before: { contractVariant: previousVariant },
      after: { contractVariant: variant },
      requestId,
    });

    logger.info('admin.batch_proof_variant.flipped', {
      requestId,
      actor: actorWallet,
      previousVariant,
      newVariant: variant,
    });

    return json({
      success: true,
      previousVariant,
      newVariant: variant,
      note: variant === 'vrf-commit-merkle'
        ? 'Go API must be redeployed for the new variant to take effect at the next batch boundary.'
        : 'Go API must be redeployed for the new variant to take effect.',
      requestId,
    });
  } catch (err) {
    logger.error('admin.batch_proof_variant.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
