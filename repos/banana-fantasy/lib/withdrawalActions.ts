// Shared withdrawal state transitions — ONE code path for marking a
// withdrawal paid or denied, used by both the single-withdrawal admin
// route (PUT /api/admin/withdrawals/[id]) and the verified batch route
// (POST /api/admin/withdrawals/mark-paid-batch). Extracted so the two
// can never drift on the money cascade.
//
// markWithdrawalPaid:
//   double-payout backstop → doc update (+paidTxHash) →
//   offramp audit/activity event → prize-paid cascade →
//   bell notification → admin audit log
//
// denyWithdrawal:
//   doc update → prize overlay rollback (prizes back to pending) →
//   cumulative-withdrawals decrement (un-inflate the $2k KYC gate) →
//   bell notification → admin audit log

import { ApiError } from '@/lib/api/errors';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { logAdminAction } from '@/lib/adminAudit';
import { markDirectWithdrawalPaid } from '@/lib/offrampAudit';
import { markPrizesPaid, clearPrizeOverlays, getPrizeClaimStates } from '@/lib/prizeOverlay';
import { createNotification } from '@/lib/queueNotifications';
import { decrementCumulativeWithdrawals } from '@/lib/db-firestore';
import { LOG_SOURCES } from '@/lib/logSources';

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function prizeIdsOf(data: Record<string, unknown>): string[] {
  return Array.isArray(data.prizeIds)
    ? (data.prizeIds.filter((s): s is string => typeof s === 'string'))
    : [];
}

export interface WithdrawalTransitionResult {
  id: string;
  userId: string;
  walletAddress: string;
  amount: number;
  status: string;
  data: Record<string, unknown>;
  before: Record<string, unknown>;
}

/**
 * Flip a withdrawal to 'paid' and run the full settlement cascade.
 * Throws ApiError(404) if missing, ApiError(409) on the double-payout
 * backstop. Idempotent: re-paying the SAME withdrawal is allowed (its
 * prizes carry its own withdrawalId; notification dedupes on id).
 */
export async function markWithdrawalPaid(opts: {
  id: string;
  actor: string;
  requestId: string;
  txHash?: string;
  /** Stamped into the audit log: did on-chain verification pass, was it
   *  skipped (and why), or absent (no hash supplied). */
  verification?: 'verified' | 'skipped' | 'none';
}): Promise<WithdrawalTransitionResult> {
  const { id, actor, requestId, txHash } = opts;
  const db = getAdminFirestore();
  const ref = db.collection('withdrawalRequests').doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new ApiError(404, 'Withdrawal request not found');
  const before = existing.data() ?? {};

  // Double-payout backstop (the hard money guarantee). Refuse if any of
  // this withdrawal's prizes were already paid by a DIFFERENT withdrawal.
  const prizeIds = prizeIdsOf(before);
  if (prizeIds.length > 0) {
    const claims = await getPrizeClaimStates(prizeIds);
    const alreadyPaidElsewhere = prizeIds.filter((pid) => {
      const c = claims.get(pid);
      return !!c && c.status === 'paid' && !!c.withdrawalId && c.withdrawalId !== id;
    });
    if (alreadyPaidElsewhere.length > 0) {
      logger.error(LOG_SOURCES.prizes.DOUBLE_PAYOUT_BLOCKED, {
        requestId,
        actor,
        context: { withdrawalId: id, alreadyPaidElsewhere },
      });
      throw new ApiError(
        409,
        `Refusing to pay — ${alreadyPaidElsewhere.length} prize(s) on this withdrawal were already paid by another withdrawal. Resolve the duplicate before settling.`,
      );
    }
  }

  const updatePayload: Record<string, unknown> = { status: 'paid', updatedAt: new Date().toISOString() };
  if (txHash) updatePayload.paidTxHash = txHash;
  await ref.set(updatePayload, { merge: true });

  const updated = await ref.get();
  const data = updated.data() ?? {};
  const userId = (typeof data.userId === 'string' ? data.userId : '').toLowerCase();
  const wallet = typeof data.walletAddress === 'string' ? data.walletAddress : undefined;
  const amount = toNumber(data.amount);
  const method = data.method === 'bank' ? 'bank' : 'usdc';

  // Cascades are best-effort: never block the admin response. Each is
  // individually idempotent.
  if (userId && amount > 0) {
    markDirectWithdrawalPaid({
      withdrawalId: id,
      userId,
      walletAddress: wallet,
      amount,
      method,
      txHash,
    }).catch((err) => {
      logger.warn('admin.mark_paid.audit_failed', { requestId, id, err: (err as Error).message });
    });
  }

  if (prizeIds.length > 0 && userId) {
    markPrizesPaid({ prizeIds, userId, withdrawalId: id }).catch((err) => {
      logger.warn('admin.mark_paid.prize_cascade_failed', { requestId, id, err: (err as Error).message });
    });
  }

  // Bell notification — the user shouldn't have to refresh /winnings to
  // learn money arrived. dedupeKey = withdrawal id → re-marking the same
  // withdrawal paid can't double-notify.
  if (userId && amount > 0) {
    createNotification(userId, {
      type: 'withdrawal_paid',
      title: `$${amount.toLocaleString()} sent to your wallet`,
      message: 'Your withdrawal is complete. USDC has been delivered on Base.',
      link: '/winnings',
      dedupeKey: `wd-paid-${id}`,
    }).catch((err) => {
      logger.warn('admin.mark_paid.notify_failed', { requestId, id, err: (err as Error).message });
    });
  }

  await logAdminAction({
    actor,
    action: 'mark-paid-withdrawal',
    target: id,
    before: { status: before.status },
    after: { status: 'paid', paidTxHash: data.paidTxHash, verification: opts.verification ?? 'none' },
    requestId,
  });

  return {
    id: updated.id,
    userId,
    walletAddress: typeof data.walletAddress === 'string' ? data.walletAddress : '',
    amount,
    status: 'paid',
    data,
    before,
  };
}

/**
 * Deny a withdrawal: prizes roll back to pending, the user's cumulative
 * withdrawal total is un-inflated, and the user is told.
 */
export async function denyWithdrawal(opts: {
  id: string;
  actor: string;
  requestId: string;
}): Promise<WithdrawalTransitionResult> {
  const { id, actor, requestId } = opts;
  const db = getAdminFirestore();
  const ref = db.collection('withdrawalRequests').doc(id);
  const existing = await ref.get();
  if (!existing.exists) throw new ApiError(404, 'Withdrawal request not found');
  const before = existing.data() ?? {};

  await ref.set({ status: 'denied', updatedAt: new Date().toISOString() }, { merge: true });

  const updated = await ref.get();
  const data = updated.data() ?? {};
  const userId = (typeof data.userId === 'string' ? data.userId : '').toLowerCase();
  const amount = toNumber(data.amount);

  // Roll back the processing overlay so the user can re-attempt the
  // withdrawal. Otherwise the prizes are stuck on 'processing' forever.
  const prizeIds = prizeIdsOf(data);
  if (prizeIds.length > 0) {
    clearPrizeOverlays(prizeIds).catch((err) => {
      logger.warn('admin.deny.prize_rollback_failed', { requestId, id, err: (err as Error).message });
    });
  }

  // Un-inflate the $2k tier-2 KYC counter — this money never moved.
  // Guard on the prior status so a double-deny can't decrement twice.
  if (userId && amount > 0 && before.status !== 'denied') {
    decrementCumulativeWithdrawals(userId, amount).catch((err) => {
      logger.warn('admin.deny.cumulative_rollback_failed', { requestId, id, err: (err as Error).message });
    });
  }

  if (userId && amount > 0) {
    createNotification(userId, {
      type: 'withdrawal_denied',
      title: 'Withdrawal could not be processed',
      message: `Your $${amount.toLocaleString()} is back in your balance — you can withdraw again or contact support.`,
      link: '/winnings',
      dedupeKey: `wd-denied-${id}`,
    }).catch((err) => {
      logger.warn('admin.deny.notify_failed', { requestId, id, err: (err as Error).message });
    });
  }

  await logAdminAction({
    actor,
    action: 'deny-withdrawal',
    target: id,
    before: { status: before.status },
    after: { status: 'denied' },
    requestId,
  });

  return {
    id: updated.id,
    userId,
    walletAddress: typeof data.walletAddress === 'string' ? data.walletAddress : '',
    amount,
    status: 'denied',
    data,
    before,
  };
}
