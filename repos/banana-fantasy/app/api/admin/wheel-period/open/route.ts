import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import {
  getCurrentPeriodNumber,
  generatePeriodSalt,
  saltHashOf,
  recordPeriodRequested,
} from '@/lib/wheelPeriod';
import {
  getWheelProofContractAddress,
  callRequestRandomnessAndCommit,
} from '@/lib/wheelProofContract';

/**
 * POST /api/admin/wheel-period/open
 *   { periodNumber?: number }  // defaults to currentPeriodNumber + 1, or 1 if none
 *
 * Step 1 of the wheel-period lifecycle: generate a fresh salt, commit its
 * hash on-chain, and request Chainlink VRF randomness — all in one tx via
 * `requestRandomnessAndCommit`. Period state advances to "requested" in
 * Firestore. Admin must call POST /api/admin/wheel-period/finalize ~30s
 * later (after the VRF coordinator fulfills) to compute the Merkle root
 * and activate the period.
 *
 * On bootstrap (no prior periods): pass periodNumber=1.
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;

    const body = (await req.json().catch(() => ({}))) as { periodNumber?: number };
    const current = await getCurrentPeriodNumber();
    const periodNumber = typeof body.periodNumber === 'number' ? body.periodNumber : (current ?? 0) + 1;
    if (!Number.isInteger(periodNumber) || periodNumber < 1) {
      throw new ApiError(400, `Invalid periodNumber: ${periodNumber}`);
    }

    const contractAddress = await getWheelProofContractAddress();
    if (!contractAddress) {
      throw new ApiError(503, 'BananaWheelProof contract not deployed yet — call /api/admin/deploy-banana-wheel-proof first');
    }

    const salt = generatePeriodSalt();
    const saltHash = saltHashOf(salt);

    logger.info('admin.wheel_period.open.submitting', {
      requestId,
      actor: actorWallet,
      periodNumber,
      contractAddress,
      saltHash,
    });

    const { txHash, requestId: vrfRequestId } = await callRequestRandomnessAndCommit(
      contractAddress,
      periodNumber,
      saltHash,
    );

    await recordPeriodRequested({
      periodNumber,
      salt,
      saltHash,
      vrfRequestId,
      commitTxHash: txHash,
    });

    await logAdminAction({
      actor: actorWallet,
      action: 'wheel-period-open',
      target: String(periodNumber),
      after: { periodNumber, saltHash, vrfRequestId, commitTxHash: txHash, contractAddress },
      requestId,
    });

    return json({
      success: true,
      periodNumber,
      saltHash,
      vrfRequestId,
      commitTxHash: txHash,
      contractAddress,
      basescanTx: `https://basescan.org/tx/${txHash}`,
      nextSteps: [
        `Wait ~30s for Chainlink VRF to fulfill, then call POST /api/admin/wheel-period/finalize { periodNumber: ${periodNumber} }`,
        'The finalize step computes the period\'s 100k outcomes, builds a Merkle tree, and commits the root on-chain. Period accepts spins after that.',
      ],
      requestId,
    });
  } catch (err) {
    logger.error('admin.wheel_period.open.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
