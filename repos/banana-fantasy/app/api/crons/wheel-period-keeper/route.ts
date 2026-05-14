export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import {
  computePeriodMerkleTree,
  getCurrentPeriod,
  generatePeriodSalt,
  recordPeriodActivated,
  recordPeriodFulfilled,
  recordPeriodRequested,
  saltHashOf,
  storePeriodLeaves,
} from '@/lib/wheelPeriod';
import {
  callCommitMerkleRoot,
  callRequestRandomnessAndCommit,
  getWheelProofContractAddress,
  readPeriodOnchain,
} from '@/lib/wheelProofContract';

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

  try {
    const contractAddress = await getWheelProofContractAddress();
    if (!contractAddress) {
      return json({ ok: true, skipped: 'no-contract' }, 200);
    }

    const summary: Record<string, unknown> = { ok: true };
    const period = await getCurrentPeriod();

    if (!period) {
      return json({ ...summary, skipped: 'no-period' }, 200);
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
        const tree = computePeriodMerkleTree(fresh.salt, fresh.vrfRandomness);
        await storePeriodLeaves(fresh.periodNumber, tree);
        const onchain = await readPeriodOnchain(contractAddress, fresh.periodNumber);
        let rootCommitTxHash: string;
        if (onchain.rootCommitted) {
          if (onchain.merkleRoot.toLowerCase() !== tree.root.toLowerCase()) {
            throw new ApiError(500, `Computed root ${tree.root} disagrees with on-chain ${onchain.merkleRoot}`);
          }
          rootCommitTxHash = '0x' + onchain.randomness.toString(16); // unused, just needs a non-null value
        } else {
          rootCommitTxHash = await callCommitMerkleRoot(contractAddress, fresh.periodNumber, tree.root);
        }
        await recordPeriodActivated({ periodNumber: fresh.periodNumber, merkleRoot: tree.root, rootCommitTxHash });
        summary.activated = { merkleRoot: tree.root, rootCommitTxHash };
      }
    }

    // (3) Auto-roll: if period is full, open the next one.
    const post = await getCurrentPeriod();
    if (post && post.spinCount >= post.maxSpins && (post.status === 'active' || post.status === 'closed')) {
      const nextNumber = post.periodNumber + 1;
      const salt = generatePeriodSalt();
      const saltHash = saltHashOf(salt);
      const { txHash, requestId } = await callRequestRandomnessAndCommit(contractAddress, nextNumber, saltHash);
      await recordPeriodRequested({
        periodNumber: nextNumber,
        salt,
        saltHash,
        vrfRequestId: requestId,
        commitTxHash: txHash,
      });
      summary.rolled = { newPeriodNumber: nextNumber, commitTxHash: txHash };
    }

    return json(summary, 200);
  } catch (err) {
    logger.error('cron.wheel_period_keeper.failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
