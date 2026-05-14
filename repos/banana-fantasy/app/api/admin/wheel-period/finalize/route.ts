import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import {
  getPeriod,
  computePeriodMerkleTree,
  recordPeriodFulfilled,
  recordPeriodActivated,
  storePeriodLeaves,
} from '@/lib/wheelPeriod';
import {
  getWheelProofContractAddress,
  readPeriodOnchain,
  callCommitMerkleRoot,
} from '@/lib/wheelProofContract';

/**
 * POST /api/admin/wheel-period/finalize
 *   { periodNumber: number }
 *
 * Step 2 of the wheel-period lifecycle. Must be called after Chainlink VRF
 * has fulfilled (~30s after open). Reads the VRF randomness from the
 * contract, pre-computes all 100k outcomes for the period, builds a
 * Merkle tree, commits the root on-chain, and flips the period to
 * "active" in Firestore. After this, the wheel spin route will derive
 * outcomes from this period's (salt, VRF) and consume spinIndexes 0..99999.
 *
 * Idempotent: if the on-chain `rootCommittedAt` is already set, this
 * endpoint just syncs Firestore to match (in case of a partial failure
 * between the on-chain commit and the Firestore update).
 *
 * Compute cost: ~1-3 seconds for 100k outcomes. Within the Vercel function
 * timeout.
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
    const periodNumber = body.periodNumber;
    if (typeof periodNumber !== 'number' || !Number.isInteger(periodNumber) || periodNumber < 1) {
      throw new ApiError(400, `Invalid periodNumber: ${periodNumber}`);
    }

    const period = await getPeriod(periodNumber);
    if (!period) throw new ApiError(404, `Wheel period ${periodNumber} not found in Firestore`);
    if (period.status === 'active' || period.status === 'closed' || period.status === 'revealed') {
      return json({
        success: true,
        alreadyFinalized: true,
        periodNumber,
        status: period.status,
        merkleRoot: period.merkleRoot,
        rootCommitTxHash: period.rootCommitTxHash,
        requestId,
      });
    }
    if (!period.salt) throw new ApiError(500, `Wheel period ${periodNumber} has no salt in Firestore — inconsistent state`);

    const contractAddress = await getWheelProofContractAddress();
    if (!contractAddress) throw new ApiError(503, 'BananaWheelProof contract not deployed');

    const onchain = await readPeriodOnchain(contractAddress, periodNumber);
    if (!onchain.fulfilled) {
      throw new ApiError(425, `Chainlink VRF has not fulfilled for period ${periodNumber} yet — wait ~30s after open and retry`);
    }

    const vrfRandomness = '0x' + onchain.randomness.toString(16).padStart(64, '0');
    if (period.status === 'requested') {
      await recordPeriodFulfilled({ periodNumber, vrfRandomness });
    }

    logger.info('admin.wheel_period.finalize.computing_root', {
      requestId,
      actor: actorWallet,
      periodNumber,
      vrfRandomness,
    });

    const tComputeStart = Date.now();
    const tree = computePeriodMerkleTree(period.salt, vrfRandomness);
    const merkleRoot = tree.root;
    const computeMs = Date.now() - tComputeStart;

    // Persist leaves so per-spin proof generation has them. Done BEFORE
    // committing the root on-chain — if storage fails, the period stays
    // "fulfilled" and the admin can retry without an on-chain mismatch.
    await storePeriodLeaves(periodNumber, tree);

    let rootCommitTxHash: string;
    if (onchain.rootCommitted) {
      // Already on-chain (partial-failure recovery): just reuse the stored root.
      if (onchain.merkleRoot.toLowerCase() !== merkleRoot.toLowerCase()) {
        throw new ApiError(500, `Computed root ${merkleRoot} disagrees with on-chain root ${onchain.merkleRoot}`);
      }
      rootCommitTxHash = period.rootCommitTxHash ?? '0x0';
    } else {
      rootCommitTxHash = await callCommitMerkleRoot(contractAddress, periodNumber, merkleRoot);
    }

    await recordPeriodActivated({ periodNumber, merkleRoot, rootCommitTxHash });

    await logAdminAction({
      actor: actorWallet,
      action: 'wheel-period-finalize',
      target: String(periodNumber),
      after: { periodNumber, merkleRoot, rootCommitTxHash, vrfRandomness, computeMs },
      requestId,
    });

    return json({
      success: true,
      periodNumber,
      status: 'active',
      vrfRandomness,
      merkleRoot,
      rootCommitTxHash,
      computeMs,
      basescanTx: `https://basescan.org/tx/${rootCommitTxHash}`,
      requestId,
    });
  } catch (err) {
    logger.error('admin.wheel_period.finalize.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
