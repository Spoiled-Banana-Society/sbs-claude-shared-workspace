import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { createPublicClient, http, type Address } from 'viem';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { BASE, BASE_RPC_URL } from '@/lib/contracts/bbb4';
import { BBB4_BATCH_PROOF_VRF_COMMIT_ABI } from '@/lib/contracts/bbb4BatchProofVRFCommitArtifact';

/**
 * GET /api/batches/{batchNumber}/proof
 *
 * Returns the on-chain proof for a given batch. Reads `batch_proofs/{N}`
 * which the Go API writes at batch boundaries.
 *
 * Two variants share this endpoint:
 *   - "commit-reveal" (legacy BBB4BatchProof): status flows
 *     "" → "committed" → "revealed". Positions exposed at "revealed".
 *   - "vrf" (BBB4BatchProofVRF, Chainlink VRF v2.5): status flows
 *     "" → "requested" → "fulfilled". Positions exposed at "fulfilled".
 *
 * Pre-launch batches (no Firestore doc) return status='pre-launch' and the
 * frontend renders the rolling-out disclaimer.
 */

type ProofStatus =
  | 'pending'
  | 'committed'
  | 'revealed'
  | 'requested'
  | 'fulfilled'
  | 'merkleCommitted'
  | 'pre-launch';

type ProofVariant = 'commit-reveal' | 'vrf' | 'vrf-commit' | 'vrf-commit-merkle';

interface BatchProofDoc {
  batchNumber: number;
  status: ProofStatus;
  variant?: ProofVariant;

  // Legacy commit-reveal
  seedHash?: string;
  commitTxHash?: string;
  commitBlock?: number;
  committedAt?: number;
  serverSeed?: string;
  publishTxHash?: string;
  publishBlock?: number;
  revealTxHash?: string;
  revealBlock?: number;
  revealedAt?: number;

  // VRF v2.5
  vrfRequestId?: string;
  vrfRequestTxHash?: string;
  vrfRequestBlock?: number;
  vrfRequestedAt?: number;
  vrfRandomness?: string;
  vrfFulfilledAt?: number;
  vrfCoordinator?: string;

  // VRF + commit hybrid
  saltHash?: string;
  serverSalt?: string;       // gated until revealed
  commitTxHashVrf?: string;  // tx that submitted requestRandomnessAndCommit
  revealSaltTxHash?: string;

  // VRF + commit + Merkle (per-draft instant verification)
  merkleRoot?: string;            // 0x-prefixed root; public from merkleCommitted onward
  merkleRootTxHash?: string;      // tx that committed the root
  merkleRootCommittedAt?: number; // unix sec

  // Common (gated)
  jackpotPositions?: number[];
  hofPositions?: number[];
  preLaunchNote?: string;
}

export async function GET(req: Request, ctx: { params: { batchNumber: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const batchNumber = Number(ctx.params.batchNumber);
    if (!Number.isInteger(batchNumber) || batchNumber < 1) {
      return jsonError('Invalid batch number', 400);
    }

    if (!isFirestoreConfigured()) {
      return json(prelaunch(batchNumber, 'Firestore not configured in this environment.'));
    }

    const db = getAdminFirestore();
    const snap = await db.collection('batch_proofs').doc(String(batchNumber)).get();
    if (!snap.exists) {
      // Pre-flight on merkle: the batch hasn't been touched yet, but a
      // merkle round may already be opened and committed for it. Surface
      // the round-level proof so the user can see the on-chain commit
      // before their draft fills.
      const merkleSynth = await tryMerkleRoundFallback(db, batchNumber);
      if (merkleSynth) return json(merkleSynth);
      return json(prelaunch(batchNumber));
    }

    const data = snap.data() as BatchProofDoc | undefined;
    if (!data) return json(prelaunch(batchNumber));

    // Positions are gated until the seed/randomness is publicly verifiable
    // on-chain. Before that, exposing them via the API would let users time
    // their draft entries to land in the slots known to be Jackpot/HOF —
    // defeating the surprise and giving an unfair edge to anyone who scrapes
    // this endpoint.
    //   - commit-reveal: gated on status==='revealed' (server seed published).
    //   - vrf:           gated on status==='fulfilled' (coordinator delivered randomness).
    //                    Note: with vrf-only, randomness lands at batch start so
    //                    positions become public ~30s after batch starts. Users
    //                    can still scrape on-chain regardless of API gating.
    //   - vrf-commit:    gated on status==='revealed' (salt revealed at batch end).
    //                    The hybrid hides positions through the entire batch
    //                    because half the entropy (salt) is sealed off-chain
    //                    until reveal — the API gating actually matches the
    //                    on-chain reality.
    const variant: ProofVariant =
      data.variant === 'vrf' ? 'vrf'
      : data.variant === 'vrf-commit-merkle' ? 'vrf-commit-merkle'
      : data.variant === 'vrf-commit' ? 'vrf-commit'
      : 'commit-reveal';

    // Firestore status flips from "requested" → "fulfilled" only when our
    // Go API processes the VRF callback (next batch boundary fill). But
    // Chainlink may have already delivered randomness on-chain seconds
    // after the request — so Firestore can lag behind reality for minutes
    // or days depending on draft cadence. Reflect on-chain truth: if the
    // doc says "requested" and the contract reports a non-zero
    // fulfilledAt, treat it as fulfilled (vrf-only) or sealed (vrf-commit,
    // which keeps the salt hidden until reveal).
    let effectiveStatus: ProofStatus = data.status;
    let effectiveFulfilledAt = data.vrfFulfilledAt;
    let effectiveRandomness = data.vrfRandomness;
    if (data.status === 'requested' && (variant === 'vrf' || variant === 'vrf-commit')) {
      const cfgSnap = await db.collection('system_config').doc('batchProof').get();
      const contractAddress = cfgSnap.exists
        ? (cfgSnap.data()?.contractAddress as Address | undefined)
        : undefined;
      if (contractAddress) {
        const onChain = await readBatchOnChain(contractAddress, BigInt(batchNumber));
        if (onChain && onChain.fulfilledAt > 0n) {
          effectiveStatus = 'fulfilled';
          effectiveFulfilledAt = Number(onChain.fulfilledAt);
          effectiveRandomness = '0x' + onChain.randomness.toString(16).padStart(64, '0');
        }
      }
    }

    const isPubliclyVerifiable =
      variant === 'vrf'
        ? effectiveStatus === 'fulfilled'
        : effectiveStatus === 'revealed';

    // For the Merkle variant, the root + commit tx are public the moment
    // status reaches merkleCommitted (they're already on-chain anyway).
    // Per-draft proofs are exposed via /api/drafts/{draftId}/merkle-proof
    // — this endpoint just publishes the root so clients can verify proofs.
    const merkleReadyForProofs =
      variant === 'vrf-commit-merkle' &&
      (effectiveStatus === 'merkleCommitted' || effectiveStatus === 'revealed');

    return json({
      batchNumber,
      status: effectiveStatus,
      variant,

      // Legacy commit-reveal fields
      seedHash: data.seedHash,
      commitTxHash: data.commitTxHash,
      commitBlock: data.commitBlock,
      committedAt: data.committedAt,
      serverSeed: variant === 'commit-reveal' && isPubliclyVerifiable ? data.serverSeed : undefined,
      publishTxHash: data.publishTxHash,
      publishBlock: data.publishBlock,
      revealTxHash: data.revealTxHash,
      revealBlock: data.revealBlock,
      revealedAt: data.revealedAt,

      // VRF fields (always public — they're on-chain regardless)
      vrfRequestId: data.vrfRequestId,
      vrfRequestTxHash: data.vrfRequestTxHash,
      vrfRequestBlock: data.vrfRequestBlock,
      vrfRequestedAt: data.vrfRequestedAt,
      vrfRandomness:
        // vrf-only: gate on fulfillment. vrf-commit: only meaningful once
        // combined with the salt, but the randomness itself is on-chain
        // anyway so we expose it as soon as we have it.
        (variant === 'vrf' || variant === 'vrf-commit') && effectiveFulfilledAt
          ? effectiveRandomness
          : undefined,
      vrfFulfilledAt: effectiveFulfilledAt,
      vrfCoordinator: data.vrfCoordinator,

      // VRF+commit and VRF+commit+merkle share the same salt-hash + salt
      // semantics. SaltHash is public from request time; serverSalt is
      // gated until reveal.
      saltHash:
        variant === 'vrf-commit' || variant === 'vrf-commit-merkle'
          ? data.saltHash
          : undefined,
      commitTxHashVrf:
        variant === 'vrf-commit' || variant === 'vrf-commit-merkle'
          ? data.commitTxHashVrf
          : undefined,
      serverSalt:
        (variant === 'vrf-commit' || variant === 'vrf-commit-merkle') && isPubliclyVerifiable
          ? data.serverSalt
          : undefined,
      revealSaltTxHash:
        variant === 'vrf-commit' || variant === 'vrf-commit-merkle'
          ? data.revealSaltTxHash
          : undefined,

      // Merkle fields (only for vrf-commit-merkle variant). Root + tx
      // become public the moment they're committed on-chain.
      merkleRoot: merkleReadyForProofs ? data.merkleRoot : undefined,
      merkleRootTxHash: merkleReadyForProofs ? data.merkleRootTxHash : undefined,
      merkleRootCommittedAt: merkleReadyForProofs ? data.merkleRootCommittedAt : undefined,

      // Common (gated)
      jackpotPositions: isPubliclyVerifiable ? data.jackpotPositions : undefined,
      hofPositions: isPubliclyVerifiable ? data.hofPositions : undefined,
      preLaunchNote: data.preLaunchNote,
    });
  } catch (err) {
    logger.error('batches.proof.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}

function prelaunch(batchNumber: number, note?: string) {
  return {
    batchNumber,
    status: 'pre-launch' as const,
    preLaunchNote:
      note ??
      'Batch fills predate the Chainlink VRF rollout. Distribution constraint (94/5/1 per 100) was enforced in code.',
  };
}

/**
 * When batch_proofs/{N} doesn't exist yet (no draft has filled in this
 * batch), check whether a merkle round is opened that will serve this
 * batch. If so, return a synthesized vrf-commit-merkle proof carrying the
 * round-level on-chain info — so the proof page can show the merkle
 * root + VRF tx before any draft in this batch fills.
 *
 * Returns null when merkle isn't active or no round serves this batch.
 */
async function tryMerkleRoundFallback(
  db: FirebaseFirestore.Firestore,
  batchNumber: number,
): Promise<BatchProofDoc | null> {
  try {
    const cfgSnap = await db.collection('system_config').doc('batchProofMerkle').get();
    if (!cfgSnap.exists) return null;

    const stateSnap = await db.collection('system_config').doc('merkleRoundState').get();
    if (!stateSnap.exists) return null;
    const state = stateSnap.data() as { currentRoundNumber?: number } | undefined;
    if (!state?.currentRoundNumber) return null;

    const roundSnap = await db.collection('merkle_rounds').doc(String(state.currentRoundNumber)).get();
    if (!roundSnap.exists) return null;
    const round = roundSnap.data() as {
      roundNumber?: number;
      status?: string;
      firstBatchNumber?: number;
      saltHash?: string;
      vrfRandomness?: string;
      merkleRoot?: string;
      merkleRootTxHash?: string;
      commitTxHashVrf?: string;
      openedAt?: number;
      merkleRootCommittedAt?: number;
    } | undefined;
    // firstBatchNumber === 0 is VALID (clean-slate launch round starts at batch
    // 0). `!round?.firstBatchNumber` treated 0 as missing → the per-draft "Verify"
    // proof page broke after the wipe (2026-06-22 falsy-zero bug, same as the feed).
    if (round?.firstBatchNumber == null) return null;

    // Bounds check: this batch must fall within the round's window.
    const lastBatchInRound = round.firstBatchNumber + 100 - 1;
    if (batchNumber < round.firstBatchNumber || batchNumber > lastBatchInRound) {
      return null;
    }

    const status: ProofStatus =
      round.status === 'merkleCommitted' ? 'merkleCommitted'
      : round.status === 'fulfilled' ? 'fulfilled'
      : round.status === 'requested' ? 'requested'
      : 'pending';

    return {
      batchNumber,
      status,
      variant: 'vrf-commit-merkle',
      saltHash: round.saltHash,
      commitTxHashVrf: round.commitTxHashVrf,
      vrfRandomness: round.vrfRandomness,
      vrfRequestedAt: round.openedAt,
      merkleRoot: round.merkleRoot,
      merkleRootTxHash: round.merkleRootTxHash,
      merkleRootCommittedAt: round.merkleRootCommittedAt,
    } as BatchProofDoc;
  } catch {
    return null;
  }
}

interface OnChainBatchState {
  vrfRequestId: bigint;
  randomness: bigint;
  saltHash: `0x${string}`;
  salt: `0x${string}`;
  requestedAt: bigint;
  fulfilledAt: bigint;
  revealedAt: bigint;
}

async function readBatchOnChain(
  contractAddress: Address,
  batchNumber: bigint,
): Promise<OnChainBatchState | null> {
  try {
    const client = createPublicClient({ chain: BASE, transport: http(BASE_RPC_URL) });
    const result = (await client.readContract({
      address: contractAddress,
      abi: BBB4_BATCH_PROOF_VRF_COMMIT_ABI,
      functionName: 'getBatch',
      args: [batchNumber],
    })) as readonly [bigint, bigint, `0x${string}`, `0x${string}`, bigint, bigint, bigint, boolean, boolean];
    return {
      vrfRequestId: result[0],
      randomness: result[1],
      saltHash: result[2],
      salt: result[3],
      requestedAt: result[4],
      fulfilledAt: result[5],
      revealedAt: result[6],
    };
  } catch (err) {
    logger.warn('batches.proof.onchain_read_failed', { err });
    return null;
  }
}
