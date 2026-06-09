// Admin-only: verified batch settlement of approved withdrawals.
//
// The admin pays the batch via Gnosis Safe (CSV Airdrop) and pastes the
// ONE batch tx hash here. The server fetches the receipt from Base,
// decodes the USDC Transfer logs, and marks paid ONLY the withdrawals
// whose wallet actually received the expected amount in that tx. The
// rest come back as `unmatched` with what the tx actually sent them —
// they stay approved so nothing is silently lost.
//
// Replaces the old client-side loop of N single mark-paid calls: one
// request, on-chain proof, per-withdrawal result.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { markWithdrawalPaid } from '@/lib/withdrawalActions';
import { verifyUsdcPayouts, type ExpectedPayout } from '@/lib/verifyPayoutTx';

const MAX_BATCH = 200;

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const body = await parseBody<{ txHash?: unknown; withdrawalIds?: unknown }>(req);
    const txHash = requireString(body.txHash, 'txHash').trim();
    if (!Array.isArray(body.withdrawalIds) || body.withdrawalIds.length === 0) {
      throw new ApiError(400, 'withdrawalIds must be a non-empty array');
    }
    const withdrawalIds = body.withdrawalIds.filter((s): s is string => typeof s === 'string' && !!s);
    if (withdrawalIds.length > MAX_BATCH) {
      throw new ApiError(400, `Too many withdrawals — max ${MAX_BATCH} per batch`);
    }

    // Load every withdrawal; only 'approved' ones are eligible (paid ones
    // are reported as already-paid, anything else is skipped with reason).
    const db = getAdminFirestore();
    const refs = withdrawalIds.map((id) => db.collection('withdrawalRequests').doc(id));
    const snaps = await db.getAll(...refs);

    const expected: ExpectedPayout[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      const id = withdrawalIds[i];
      if (!snap.exists) {
        skipped.push({ id, reason: 'not found' });
        continue;
      }
      const w = snap.data() ?? {};
      if (w.status === 'paid') {
        skipped.push({ id, reason: 'already paid' });
        continue;
      }
      if (w.status !== 'approved') {
        skipped.push({ id, reason: `status is '${w.status}' — approve first` });
        continue;
      }
      const wallet = typeof w.walletAddress === 'string' && w.walletAddress
        ? w.walletAddress
        : (typeof w.userId === 'string' ? w.userId : '');
      const amount = typeof w.amount === 'number' ? w.amount : Number(w.amount);
      if (!wallet || !Number.isFinite(amount) || amount <= 0) {
        skipped.push({ id, reason: 'missing wallet or amount on the withdrawal doc' });
        continue;
      }
      expected.push({ key: id, wallet, amount });
    }

    if (expected.length === 0) {
      return json({ paid: [], unmatched: [], skipped, txStatus: 'nothing_to_verify', requestId });
    }

    // On-chain proof.
    const verification = await verifyUsdcPayouts(txHash, expected);
    if (verification.status === 'tx_not_found') {
      throw new ApiError(409, 'Transaction not found on Base yet — if the Safe batch just executed, wait a moment and retry.');
    }
    if (verification.status === 'tx_failed') {
      throw new ApiError(400, 'That transaction reverted on-chain — no USDC moved. Nothing was marked paid.');
    }

    // Settle only the verified ones; each runs the full shared cascade
    // (backstop, doc update, prize flips, bell notification, audit).
    const paid: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of verification.verified) {
      try {
        await markWithdrawalPaid({ id, actor, requestId, txHash, verification: 'verified' });
        paid.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await logAdminAction({
      actor,
      action: 'mark-paid-batch',
      target: txHash,
      after: {
        paidCount: paid.length,
        unmatchedCount: verification.unmatched.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
      },
      requestId,
    });

    logger.info('admin.mark_paid_batch.ok', {
      requestId,
      actor,
      txHash,
      paidCount: paid.length,
      unmatchedCount: verification.unmatched.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      durationMs: Date.now() - start,
    });

    return json({
      paid,
      unmatched: verification.unmatched,
      skipped,
      failed,
      txStatus: 'verified',
      requestId,
    });
  } catch (err) {
    logger.error('admin.mark_paid_batch.failed', { requestId, actor, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
