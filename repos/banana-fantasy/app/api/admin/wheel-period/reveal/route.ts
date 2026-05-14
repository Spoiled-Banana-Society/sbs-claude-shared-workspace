import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import type { Hex } from 'viem';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import {
  getPeriod,
  recordPeriodClosed,
  recordPeriodRevealed,
} from '@/lib/wheelPeriod';
import {
  getWheelProofContractAddress,
  callRevealSalt,
} from '@/lib/wheelProofContract';

/**
 * POST /api/admin/wheel-period/reveal
 *   { periodNumber: number }
 *
 * Step 4 of the wheel-period lifecycle. Publishes the period's salt
 * on-chain — the contract verifies `keccak256(salt) == saltHash` and
 * records it. After this, anyone with the (now public) salt + VRF
 * randomness can re-derive every outcome the period assigned and confirm
 * they match the on-chain Merkle root.
 *
 * Marks the period "closed" first if not already (handles the case where
 * the cron didn't run or admin is closing+revealing in one shot).
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
    if (!period) throw new ApiError(404, `Wheel period ${periodNumber} not found`);
    if (period.status === 'revealed') {
      return json({ success: true, alreadyRevealed: true, periodNumber, revealTxHash: period.revealTxHash, requestId });
    }
    if (period.status !== 'active' && period.status !== 'closed') {
      throw new ApiError(400, `Period ${periodNumber} status=${period.status} — must be active or closed before reveal`);
    }
    if (!period.salt) throw new ApiError(500, `Wheel period ${periodNumber} missing salt — inconsistent state`);

    const contractAddress = await getWheelProofContractAddress();
    if (!contractAddress) throw new ApiError(503, 'BananaWheelProof contract not deployed');

    if (period.status === 'active') {
      await recordPeriodClosed(periodNumber);
    }

    const revealTxHash = await callRevealSalt(contractAddress, periodNumber, period.salt as Hex);
    await recordPeriodRevealed({ periodNumber, revealTxHash });

    await logAdminAction({
      actor: actorWallet,
      action: 'wheel-period-reveal',
      target: String(periodNumber),
      after: { periodNumber, revealTxHash, salt: period.salt },
      requestId,
    });

    return json({
      success: true,
      periodNumber,
      status: 'revealed',
      revealTxHash,
      basescanTx: `https://basescan.org/tx/${revealTxHash}`,
      requestId,
    });
  } catch (err) {
    logger.error('admin.wheel_period.reveal.failed', { requestId, actor: actorWallet, err });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError((err as Error).message || 'Internal Server Error', 500, { requestId });
  }
}
