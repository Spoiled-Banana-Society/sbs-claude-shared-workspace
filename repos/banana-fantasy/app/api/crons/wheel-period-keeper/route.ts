export const dynamic = 'force-dynamic';

import type { Hex } from 'viem';
import { runInBackground } from '@/lib/serverBackground';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import {
  computePeriodMerkleTree,
  getCurrentPeriod,
  generatePeriodSalt,
  getPeriod,
  periodSegments,
  recordPeriodActivated,
  recordPeriodClosed,
  recordPeriodFulfilled,
  recordPeriodRequested,
  recordPeriodRevealed,
  saltHashOf,
  storePeriodLeaves,
} from '@/lib/wheelPeriod';
import {
  callCommitMerkleRoot,
  callRequestRandomnessAndCommit,
  callRevealSalt,
  getWheelProofContractAddress,
  readPeriodOnchain,
} from '@/lib/wheelProofContract';
import { commitPendingBatches } from '@/lib/wheelAssignmentJournal';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { jackhofWheelSegments, wheelSegments, JACKHOF_WHEEL_FROM_FILLED, type WheelSegment } from '@/lib/wheelConfig';

/**
 * The wedge set for a NEWLY-opened period, chosen at open time from the live
 * draft counter: once the rolling era is reached (draft 200 filled), every
 * new period carries the JackHOF wedge. Existing periods are never touched —
 * their outcomes stay locked to the snapshot committed at their open.
 */
async function segmentsForNewPeriod(): Promise<WheelSegment[]> {
  const snap = await getAdminFirestore().collection('drafts').doc('draftTracker').get();
  const filled = Number((snap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount ?? 0);
  return filled >= JACKHOF_WHEEL_FROM_FILLED ? jackhofWheelSegments : wheelSegments;
}

/**
 * Vercel cron — runs every 5 minutes. Two responsibilities:
 *
 * 1. Auto-advance the current period through the state machine if it's
 *    waiting on a step that doesn't require human attention:
 *      - requested → fulfilled: poll the contract, persist VRF
 *        randomness when it lands
 *      - fulfilled → active: compute outcomes, build Merkle tree,
 *        commit root on-chain
 *
 * 2. Auto-roll: if the current period is full (10k spins) but no next
 *    period exists yet, open period N+1 so spins never block.
 *
 * Reveal is intentionally still manual (admin button) — closing a
 * period is a public ceremony and we want a human in the loop for that.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
  // Vercel cron sends its own auth — be permissive in dev/staging if no secret configured.
  if (expected && auth !== expected && !req.headers.get('x-vercel-cron')) {
    return jsonError('Unauthorized', 401);
  }

  runInBackground('cron.heartbeat', recordCronHeartbeat('wheel-period-keeper')); // liveness for the watchdog

  try {
    const contractAddress = await getWheelProofContractAddress();
    if (!contractAddress) {
      return json({ ok: true, skipped: 'no-contract' }, 200);
    }

    const summary: Record<string, unknown> = { ok: true };
    let period = await getCurrentPeriod();

    // (0) Bootstrap period 1 if no period exists yet. Contract must be
    // deployed (checked above) — admin only has to do the deploy once;
    // the cron starts the first period automatically.
    if (!period) {
      const salt = generatePeriodSalt();
      const saltHash = saltHashOf(salt);
      const { txHash, requestId } = await callRequestRandomnessAndCommit(contractAddress, 1, saltHash);
      await recordPeriodRequested({
        periodNumber: 1,
        salt,
        saltHash,
        vrfRequestId: requestId,
        commitTxHash: txHash,
        segments: await segmentsForNewPeriod(),
      });
      summary.bootstrapped = { periodNumber: 1, commitTxHash: txHash };
      period = await getCurrentPeriod();
      if (!period) return json(summary, 200);
    }

    summary.periodNumber = period.periodNumber;
    summary.startStatus = period.status;

    // (1) Advance state if VRF has fulfilled but we haven't persisted yet.
    if (period.status === 'requested') {
      const onchain = await readPeriodOnchain(contractAddress, period.periodNumber);
      if (onchain.fulfilled) {
        const vrfRandomness = '0x' + onchain.randomness.toString(16).padStart(64, '0');
        await recordPeriodFulfilled({ periodNumber: period.periodNumber, vrfRandomness });
        summary.fulfilled = vrfRandomness;
      }
    }

    // (2) If fulfilled but not yet active, compute root + commit on-chain.
    if (period.status === 'fulfilled' || summary.fulfilled) {
      const fresh = await getCurrentPeriod();
      if (fresh && fresh.status === 'fulfilled' && fresh.salt && fresh.vrfRandomness) {
        // Derive the 100k outcomes from the PERIOD's committed snapshot —
        // never the deployed static config (may be a newer generation).
        const tree = computePeriodMerkleTree(fresh.salt, fresh.vrfRandomness, periodSegments(fresh));
        await storePeriodLeaves(fresh.periodNumber, tree);
        const onchain = await readPeriodOnchain(contractAddress, fresh.periodNumber);
        let rootCommitTxHash: string;
        if (onchain.rootCommitted) {
          if (onchain.merkleRoot.toLowerCase() !== tree.root.toLowerCase()) {
            throw new ApiError(500, `Computed root ${tree.root} disagrees with on-chain ${onchain.merkleRoot}`);
          }
          rootCommitTxHash = fresh.rootCommitTxHash ?? '0x';
        } else {
          rootCommitTxHash = await callCommitMerkleRoot(contractAddress, fresh.periodNumber, tree.root);
        }
        await recordPeriodActivated({ periodNumber: fresh.periodNumber, merkleRoot: tree.root, rootCommitTxHash });
        summary.activated = { merkleRoot: tree.root, rootCommitTxHash };
      }
    }

    // (3) Auto-roll: if period is full, open the next one AND auto-reveal
    //     the salt of the full period so the public can audit. Both happen
    //     server-side so no human intervention is needed once the contract
    //     is deployed — the wheel runs forever from one deploy.
    const post = await getCurrentPeriod();
    if (post && post.spinCount >= post.maxSpins && (post.status === 'active' || post.status === 'closed')) {
      // Open next period first so spins don't stall while the old one reveals.
      const nextNumber = post.periodNumber + 1;
      const salt = generatePeriodSalt();
      const saltHash = saltHashOf(salt);
      const nextSegments = await segmentsForNewPeriod();
      const { txHash, requestId } = await callRequestRandomnessAndCommit(contractAddress, nextNumber, saltHash);
      await recordPeriodRequested({
        periodNumber: nextNumber,
        salt,
        saltHash,
        vrfRequestId: requestId,
        commitTxHash: txHash,
        segments: nextSegments,
      });
      summary.rolled = {
        newPeriodNumber: nextNumber,
        commitTxHash: txHash,
        hasJackhof: nextSegments.some((s) => s.id === 'jackhof'),
      };

      // Now reveal the salt of the freshly-full period so it's publicly auditable.
      try {
        if (post.status === 'active') {
          await recordPeriodClosed(post.periodNumber);
        }
        const filled = await getPeriod(post.periodNumber);
        if (filled?.salt) {
          const revealTxHash = await callRevealSalt(contractAddress, post.periodNumber, filled.salt as Hex);
          await recordPeriodRevealed({ periodNumber: post.periodNumber, revealTxHash });
          summary.revealed = { periodNumber: post.periodNumber, revealTxHash };
        }
      } catch (revealErr) {
        logger.warn('cron.wheel_period_keeper.reveal_failed', {
          periodNumber: post.periodNumber,
          err: (revealErr as Error).message,
        });
        summary.revealError = (revealErr as Error).message;
      }
    }

    // (4) Provably-fair assignment-batch commitments. Every 100 spins we
    //     publish an on-chain Merkle root of "wallet → spinIndex"
    //     assignments so the order in which we hand out pre-committed
    //     outcomes can't be secretly rewritten. Runs entirely in the
    //     background of this cron — never blocks user spins.
    //
    //     Scan the current period plus the previous one (in case the
    //     previous period's last batch arrived just after rollover).
    //     Each call commits all ready batches up to a per-period cap so
    //     a big backlog doesn't tie up the whole cron tick.
    const settledPeriod = await getCurrentPeriod();
    const periodsToScan: number[] = [];
    if (settledPeriod) {
      periodsToScan.push(settledPeriod.periodNumber);
      if (settledPeriod.periodNumber > 1) {
        periodsToScan.push(settledPeriod.periodNumber - 1);
      }
    }
    try {
      const committed = await commitPendingBatches(periodsToScan);
      if (committed.length > 0) {
        summary.assignmentBatchesCommitted = committed.map((c) => ({
          periodNumber: c.periodNumber,
          batchIndex: c.batchIndex,
          range: [c.fromIndex, c.toIndex],
          txHash: c.txHash,
        }));
      }
    } catch (assignErr) {
      // Soft-fail — assignment commits are non-blocking for the wheel.
      // The error already logged inside commitPendingBatches; surface
      // the count in the summary for the keeper's structured response.
      summary.assignmentBatchError = (assignErr as Error).message;
    }

    return json(summary, 200);
  } catch (err) {
    logger.error('cron.wheel_period_keeper.failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
