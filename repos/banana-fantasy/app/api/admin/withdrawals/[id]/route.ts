import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { type Timestamp } from 'firebase-admin/firestore';

import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { markDirectWithdrawalPaid } from '@/lib/offrampAudit';
import { markPrizesPaid, clearPrizeOverlays, getPrizeClaimStates } from '@/lib/prizeOverlay';
import { LOG_SOURCES } from '@/lib/logSources';

type FirestoreTimestamp = Timestamp | { toDate: () => Date };

function toIsoDate(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as FirestoreTimestamp).toDate === 'function') {
    const date = (value as FirestoreTimestamp).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const { id } = params;
    if (!id) throw new ApiError(400, 'Missing withdrawal id');

    const body = await parseBody<{ status?: unknown; txHash?: unknown }>(req);
    // 'paid' is the post-Gnosis-batch confirmation: USDC has actually
    // landed in the user's wallet. That's when the user-facing activity
    // event fires. 'approved' is the queue gate before the batch send.
    if (body.status !== 'approved' && body.status !== 'denied' && body.status !== 'paid') {
      throw new ApiError(400, 'Invalid status. Expected approved, denied, or paid');
    }
    const txHash = typeof body.txHash === 'string' && body.txHash.trim() ? body.txHash.trim() : undefined;

    const db = getAdminFirestore();
    const ref = db.collection('withdrawalRequests').doc(id);
    const existing = await ref.get();
    if (!existing.exists) throw new ApiError(404, 'Withdrawal request not found');
    const before = existing.data() ?? {};

    // Double-payout backstop (the hard money guarantee). Before flipping
    // this withdrawal to 'paid', refuse if any of its prizes were already
    // paid by a DIFFERENT withdrawal — that prize's money has already
    // gone out, so paying again would double-pay. Idempotent: re-paying
    // THIS same withdrawal id is allowed (its own prizes carry its id).
    if (body.status === 'paid') {
      const prizeIds = Array.isArray(before.prizeIds)
        ? (before.prizeIds.filter((s): s is string => typeof s === 'string'))
        : [];
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
    }

    const updatePayload: Record<string, unknown> = { status: body.status, updatedAt: new Date().toISOString() };
    if (body.status === 'paid' && txHash) updatePayload.paidTxHash = txHash;
    await ref.set(updatePayload, { merge: true });

    const updated = await ref.get();
    const data = updated.data() ?? {};

    // When marking paid, fire the user-facing activity event, update
    // the matching offramp_attempt, AND cascade prize-paid status to
    // every prize this withdrawal settles (via the prizeIds field on
    // the withdrawal doc). Idempotent — calling twice won't
    // double-emit. Best-effort: never block the admin response on it.
    if (body.status === 'paid') {
      const userId = (typeof data.userId === 'string' ? data.userId : '').toLowerCase();
      const wallet = typeof data.walletAddress === 'string' ? data.walletAddress : undefined;
      const amount = toNumber(data.amount);
      const method = data.method === 'bank' ? 'bank' : 'usdc';
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

      // Cascade: flip every prize this withdrawal settles to 'paid'.
      // prizeIds is set by the new /api/prizes/withdraw-all flow. Old
      // single-prize withdrawals don't have it — no-op there.
      const prizeIds = Array.isArray(data.prizeIds)
        ? (data.prizeIds.filter((s): s is string => typeof s === 'string'))
        : [];
      if (prizeIds.length > 0 && userId) {
        markPrizesPaid({ prizeIds, userId, withdrawalId: id }).catch((err) => {
          logger.warn('admin.mark_paid.prize_cascade_failed', { requestId, id, err: (err as Error).message });
        });
      }
    }

    // If denied, roll back the processing overlay so the user can
    // re-attempt the withdrawal. Otherwise the prizes get stuck on
    // 'processing' forever from the frontend's perspective.
    if (body.status === 'denied') {
      const prizeIds = Array.isArray(data.prizeIds)
        ? (data.prizeIds.filter((s): s is string => typeof s === 'string'))
        : [];
      if (prizeIds.length > 0) {
        clearPrizeOverlays(prizeIds).catch((err) => {
          logger.warn('admin.deny.prize_rollback_failed', { requestId, id, err: (err as Error).message });
        });
      }
    }

    const action: 'approve-withdrawal' | 'deny-withdrawal' | 'mark-paid-withdrawal' =
      body.status === 'approved' ? 'approve-withdrawal'
      : body.status === 'denied' ? 'deny-withdrawal'
      : 'mark-paid-withdrawal';
    await logAdminAction({
      actor,
      action,
      target: id,
      before: { status: before.status },
      after: { status: data.status, paidTxHash: data.paidTxHash },
      requestId,
    });

    logger.info('admin.withdrawal_status.ok', {
      requestId,
      actor,
      target: id,
      status: body.status,
      durationMs: Date.now() - start,
    });

    return json({
      id: updated.id,
      userId: typeof data.userId === 'string' ? data.userId : '',
      walletAddress: typeof data.walletAddress === 'string' ? data.walletAddress : '',
      amount: toNumber(data.amount),
      status: typeof data.status === 'string' ? data.status : body.status,
      createdAt: toIsoDate(data.createdAt),
      blueCheckVerified: data.blueCheckVerified === true || data.isBlueCheckVerified === true,
      requestId,
    });
  } catch (err) {
    logger.error('admin.withdrawal_status.failed', { requestId, actor, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
