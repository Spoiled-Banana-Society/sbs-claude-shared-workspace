import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { generateSpinProof, getPeriod, toPublicSummary } from '@/lib/wheelPeriod';
import { getWheelProofContractAddress } from '@/lib/wheelProofContract';

/**
 * GET /api/wheel/proof/{spinId} — public per-spin verification payload.
 * Returns the spin record + period summary + Merkle proof. Anyone can
 * hit this and verify the spin's outcome against the on-chain root.
 *
 * Legacy spins (taken before the wheel-proof system was bootstrapped)
 * return without a proof and with `verifiable: false`. The /spin-proof
 * page displays them as "pre-VRF" so users know they're not part of the
 * verification system.
 */
export async function GET(_req: Request, ctx: { params: { spinId: string } }) {
  const rateLimited = rateLimit(_req, RATE_LIMITS.wheel);
  if (rateLimited) return rateLimited;
  try {
    const spinId = ctx.params.spinId?.trim();
    if (!spinId) throw new ApiError(400, 'Missing spinId');

    const db = getAdminFirestore();
    // The spin is stored at v2_users/{userId}/wheelSpins/{spinId}. We
    // don't know the userId from the spinId alone, so do a collection-
    // group query — there are at most a few thousand spins, so an index
    // scan is fine.
    const snap = await db.collectionGroup('wheelSpins').where('spinId', '==', spinId).limit(1).get();
    if (snap.empty) throw new ApiError(404, `spinId ${spinId} not found`);

    const data = snap.docs[0].data() as {
      userId?: string;
      spinId: string;
      result: string;
      timestamp: string;
      periodNumber?: number | null;
      spinIndexInPeriod?: number | null;
    };

    const verifiable = typeof data.periodNumber === 'number' && typeof data.spinIndexInPeriod === 'number';
    if (!verifiable) {
      return json({
        spinId: data.spinId,
        result: data.result,
        timestamp: data.timestamp,
        verifiable: false,
        reason: 'pre-VRF spin — taken before the verification system was bootstrapped',
      }, 200);
    }

    const period = await getPeriod(data.periodNumber!);
    if (!period) throw new ApiError(500, `Spin references missing period ${data.periodNumber}`);

    const contractAddress = await getWheelProofContractAddress();

    let proof: { leaf: string; path: string[]; root: string } | null = null;
    if (period.status === 'active' || period.status === 'closed' || period.status === 'revealed') {
      try {
        const p = await generateSpinProof(data.periodNumber!, data.spinIndexInPeriod!);
        proof = { leaf: p.leaf, path: p.proof, root: p.root };
      } catch (proofErr) {
        logger.warn('wheel.proof.generation_failed', { spinId, err: (proofErr as Error).message });
      }
    }

    return json({
      spinId: data.spinId,
      result: data.result,
      timestamp: data.timestamp,
      verifiable: true,
      periodNumber: data.periodNumber,
      spinIndex: data.spinIndexInPeriod,
      period: toPublicSummary(period),
      contractAddress,
      proof,
    }, 200);
  } catch (err) {
    logger.error('wheel.proof.failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
