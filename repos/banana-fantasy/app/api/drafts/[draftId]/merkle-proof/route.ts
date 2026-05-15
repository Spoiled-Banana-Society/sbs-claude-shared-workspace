import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import type { Hex } from 'viem';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { buildDraftMerkleProof, type DraftType } from '@/lib/batchMerkleClient';
import { locateDraft, parseDraftNumber } from '@/lib/batchProof';

/**
 * GET /api/drafts/{draftId}/merkle-proof
 *
 * Returns the Merkle proof for a specific draft's (positionInRound,
 * draftType) leaf against the on-chain round root. The Merkle round
 * covers 10,000 drafts = 100 batches × 100 drafts. Each draft within a
 * round can be verified independently against a single on-chain root.
 *
 * Dereference path:
 *   1. Parse draftId → globalDraftNumber → batchNumber, positionInBatch
 *   2. Read batch_proofs/{batchN} (pointer doc) → merkleRound, batchIndexInRound
 *   3. positionInRound = batchIndexInRound * 100 + positionInBatch
 *   4. Read merkle_rounds/{roundN} → leaves[], merkleRoot, draftType for this position
 *   5. Build the Merkle proof path from the leaves
 *
 * Only available when the batch is on the vrf-commit-merkle variant AND
 * the round is at status >= "merkleCommitted".
 */
export async function GET(req: Request, ctx: { params: { draftId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const draftId = ctx.params.draftId?.trim();
    if (!draftId) return jsonError('Missing draftId', 400);

    const draftNumber = parseDraftNumber(draftId);
    if (draftNumber === null) {
      return jsonError(`Could not parse draft number from id: ${draftId}`, 400);
    }
    const locator = locateDraft(draftNumber);

    if (!isFirestoreConfigured()) {
      return jsonError('Firestore not configured', 503);
    }

    const db = getAdminFirestore();
    const batchSnap = await db.collection('batch_proofs').doc(String(locator.batchNumber)).get();
    if (!batchSnap.exists) {
      return jsonError(`Batch ${locator.batchNumber} has no proof on file`, 404);
    }

    const batchData = batchSnap.data() as {
      variant?: string;
      status?: string;
      merkleRound?: number;
      merkleBatchIndexInRound?: number;
      merkleRoot?: string;
      merkleRootTxHash?: string;
      jackpotPositions?: number[];
      hofPositions?: number[];
    } | undefined;

    if (!batchData) return jsonError('Batch proof doc malformed', 500);

    if (batchData.variant !== 'vrf-commit-merkle') {
      return jsonError(`Batch ${locator.batchNumber} uses variant=${batchData.variant ?? 'unknown'}; per-draft Merkle proofs not available`, 404);
    }

    if (!batchData.merkleRound || batchData.merkleBatchIndexInRound === undefined) {
      return jsonError(`Batch ${locator.batchNumber} missing merkle round pointer — server bug`, 500);
    }

    const merkleReady =
      batchData.status === 'merkleCommitted' || batchData.status === 'revealed';
    if (!merkleReady) {
      return jsonError(`Batch ${locator.batchNumber} not yet at merkleCommitted state (status=${batchData.status})`, 425);
    }

    const roundSnap = await db.collection('merkle_rounds').doc(String(batchData.merkleRound)).get();
    if (!roundSnap.exists) {
      return jsonError(`Merkle round ${batchData.merkleRound} not found`, 500);
    }
    const roundData = roundSnap.data() as {
      merkleLeaves?: string[];
      merkleRoot?: string;
      merkleRootTxHash?: string;
    } | undefined;
    if (!roundData?.merkleLeaves?.length || !roundData.merkleRoot) {
      return jsonError(`Merkle round ${batchData.merkleRound} not finalized — server bug`, 500);
    }

    // Determine this draft's type from the batch's window slots.
    const isJackpot = (batchData.jackpotPositions ?? []).includes(locator.positionInBatch);
    const isHof = (batchData.hofPositions ?? []).includes(locator.positionInBatch);
    const draftType: DraftType = isJackpot ? 'jackpot' : isHof ? 'hof' : 'pro';

    const positionInRound = batchData.merkleBatchIndexInRound * 100 + locator.positionInBatch;
    const leaves = roundData.merkleLeaves as Hex[];
    if (positionInRound < 0 || positionInRound >= leaves.length) {
      return jsonError(`positionInRound ${positionInRound} out of range [0,${leaves.length})`, 500);
    }

    const proof = buildDraftMerkleProof(leaves, positionInRound);

    return json({
      draftId,
      draftNumber,
      batchNumber: locator.batchNumber,
      positionInBatch: locator.positionInBatch,
      roundNumber: batchData.merkleRound,
      positionInRound,
      draftType,
      leaf: leaves[positionInRound],
      proof,
      root: roundData.merkleRoot,
      rootTxHash: roundData.merkleRootTxHash ?? batchData.merkleRootTxHash ?? null,
    });
  } catch (err) {
    logger.error('drafts.merkle_proof.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
