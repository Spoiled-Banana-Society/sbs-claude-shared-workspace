/**
 * GET /api/wheel/assignment-proof/{spinId}
 *
 * Per-spin assignment-proof endpoint. Returns the Merkle proof showing
 * that the spin's wallet was assigned the spin's spinIndex inside the
 * batch that was committed on-chain. Combined with the existing
 * /api/wheel/proof/{spinId} (outcome proof) this gives end-to-end
 * cryptographic verifiability:
 *
 *   • outcome proof → "spinIndex N → outcome X" (vs on-chain outcomes root)
 *   • assignment proof → "wallet W → spinIndex N" (vs on-chain batch root)
 *
 * If the spin's batch hasn't been committed yet (still in the pending
 * tail), returns `pending: true` so the UI can show "verification
 * committing soon (every 100 spins)" instead of an error.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import {
  ASSIGNMENT_BATCH_SIZE,
  findBatchForSpin,
} from '@/lib/wheelAssignmentJournal';
import {
  assignmentLeafHash,
  getAssignmentMerkleProof,
  rebuildAssignmentTreeFromLeaves,
} from '@/lib/wheelAssignmentMerkle';
import { getWheelAssignmentJournalAddress } from '@/lib/wheelAssignmentContract';
import { logger } from '@/lib/logger';
import type { Hex } from 'viem';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: { spinId: string } },
) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const spinId = ctx.params.spinId?.trim();
    if (!spinId) throw new ApiError(400, 'Missing spinId');

    const db = getAdminFirestore();
    const spinSnap = await db
      .collectionGroup('wheelSpins')
      .where('spinId', '==', spinId)
      .limit(1)
      .get();
    if (spinSnap.empty) throw new ApiError(404, `spinId ${spinId} not found`);
    const data = spinSnap.docs[0].data() as {
      userId?: string;
      spinId: string;
      periodNumber?: number | null;
      spinIndexInPeriod?: number | null;
    };

    if (
      typeof data.periodNumber !== 'number' ||
      typeof data.spinIndexInPeriod !== 'number' ||
      !data.userId
    ) {
      return json({
        ok: true,
        spinId: data.spinId,
        verifiable: false,
        reason: 'pre-VRF or pre-assignment-journal spin',
      });
    }

    const periodNumber = data.periodNumber;
    const spinIndex = data.spinIndexInPeriod;
    const wallet = data.userId.toLowerCase();

    const batch = await findBatchForSpin(periodNumber, spinIndex);
    const contractAddress = await getWheelAssignmentJournalAddress();

    if (!batch) {
      // Spin happened but its batch hasn't been committed yet (still in
      // the pending tail, waiting for the next ~100-spin window to fill).
      const positionInBatch = spinIndex % ASSIGNMENT_BATCH_SIZE;
      return json({
        ok: true,
        spinId,
        verifiable: false,
        pending: true,
        periodNumber,
        spinIndex,
        wallet,
        batchSize: ASSIGNMENT_BATCH_SIZE,
        positionInBatch,
        contractAddress: contractAddress ?? null,
        reason:
          'Assignment commits in batches of 100 spins. This spin is in the next pending batch — it will be on-chain on the next cron tick after the batch fills.',
      });
    }

    // Regenerate the Merkle proof for this spin's leaf inside its batch.
    // We persisted the leaves alongside the batch metadata so a single
    // doc read gives us everything needed — no re-fetch of every entry.
    const leaves = batch.leaves as Hex[];
    if (leaves.length === 0) {
      throw new ApiError(500, `Batch ${batch.batchIndex} has no stored leaves`);
    }
    // Rebuild the tree from leaves; cheap (~1ms for 100 leaves).
    // Sanity check: the wallet's leaf must match the stored leaf at the
    // expected offset, otherwise the journal disagrees with the spin doc
    // (would be a serious bug worth surfacing).
    const positionInBatch = spinIndex - batch.fromIndex;
    const expectedLeaf = assignmentLeafHash(spinIndex, wallet);
    if (expectedLeaf.toLowerCase() !== leaves[positionInBatch]?.toLowerCase()) {
      logger.error('wheel.assignment_proof.mismatch', {
        err: 'Stored leaf does not match recomputed leaf',
        route: 'wheel/assignment-proof',
        context: {
          spinId,
          periodNumber,
          spinIndex,
          wallet,
          batchIndex: batch.batchIndex,
          expectedLeaf,
          storedLeaf: leaves[positionInBatch],
        },
      });
      throw new ApiError(500, 'Journal/spin doc disagreement — see admin Logs');
    }

    // Rebuild the tree from the stored leaves (no wallet refetch
    // needed — leaves are hashes of (spinIndex, wallet) and were
    // persisted at commit time). Cheap: ~1ms for 100 leaves.
    const tree = rebuildAssignmentTreeFromLeaves(leaves);

    if (tree.root.toLowerCase() !== batch.root.toLowerCase()) {
      logger.error('wheel.assignment_proof.root_mismatch', {
        err: 'Recomputed root does not match committed root',
        route: 'wheel/assignment-proof',
        context: { spinId, periodNumber, batchIndex: batch.batchIndex, recomputed: tree.root, committed: batch.root },
      });
      throw new ApiError(500, 'Journal root disagreement — see admin Logs');
    }

    const proof = getAssignmentMerkleProof(tree, positionInBatch);

    return json({
      ok: true,
      spinId,
      verifiable: true,
      periodNumber,
      spinIndex,
      wallet,
      contractAddress: contractAddress ?? null,
      batch: {
        batchIndex: batch.batchIndex,
        fromIndex: batch.fromIndex,
        toIndex: batch.toIndex,
        count: batch.toIndex - batch.fromIndex + 1,
        root: batch.root,
        txHash: batch.txHash,
        committedAt: batch.committedAt,
      },
      proof: {
        leaf: leaves[positionInBatch],
        path: proof,
        root: batch.root,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('wheel.assignment_proof.failed', { err });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}

