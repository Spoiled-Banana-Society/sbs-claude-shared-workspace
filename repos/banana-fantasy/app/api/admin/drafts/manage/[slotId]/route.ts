/**
 * DELETE /api/admin/drafts/manage/{slotId}
 *
 * Admin-only flow that:
 *   1. Reads `drafts/{slotId}/cards/*` from Firestore.
 *   2. For each card, calls the Go API's `/league/{slotId}/actions/leave`
 *      endpoint — that's the canonical token-refund path.
 *   3. Deletes Firestore `drafts/{slotId}/state/*`, `drafts/{slotId}/cards/*`,
 *      `drafts/{slotId}`, and the matching RTDB node.
 *
 * Refuses to delete `draftTracker` (would reset the guaranteed-distribution
 * counter — see project_vrf_merkle_setup.md "Recovery" for what that breaks).
 *
 * Logs every step under tag `admin.drafts.manage.delete.*` so failed leaves
 * or partial deletes are visible in the admin Logs tab.
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, getAdminDatabase } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { draftsApiServer } from '@/lib/draftsApiServer';

const PROTECTED_DOC_IDS = new Set(['draftTracker']);
const STATE_SUBCOLS = ['info', 'summary', 'playerState', 'rosters', 'connectionList', 'sortOrders'];

interface LeaveResult {
  ownerId: string;
  tokenId: string;
  ok: boolean;
  status: number;
  error?: string;
}

export async function DELETE(
  req: Request,
  { params }: { params: { slotId: string } },
) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  const slotId = params.slotId;
  if (!slotId) {
    return jsonError('Missing slotId', 400);
  }
  if (PROTECTED_DOC_IDS.has(slotId)) {
    logger.warn('admin.drafts.manage.delete.refused_protected', { requestId, slotId });
    return jsonError(`Refusing to delete protected doc: ${slotId}`, 400);
  }

  try {
    const { walletAddress } = await requireAdmin(req);

    logger.info('admin.drafts.manage.delete.start', {
      requestId,
      slotId,
      adminWallet: walletAddress,
    });

    const db = getAdminFirestore();
    const rtdb = getAdminDatabase();
    if (!rtdb) {
      throw new ApiError(500, 'Realtime Database not configured');
    }

    // Confirm the draft exists before doing destructive ops.
    const doc = await db.collection('drafts').doc(slotId).get();
    if (!doc.exists) {
      logger.warn('admin.drafts.manage.delete.not_found', { requestId, slotId });
      return jsonError(`Draft not found: ${slotId}`, 404);
    }

    // 1) Refund tokens by calling the Go API's leave endpoint for each card.
    const cardsSnap = await db.collection('drafts').doc(slotId).collection('cards').get();
    const leaveResults: LeaveResult[] = [];
    for (const c of cardsSnap.docs) {
      const data = c.data() as Record<string, unknown>;
      const ownerId = (data.OwnerId ?? data.ownerId) as string | undefined;
      const tokenId = c.id;
      if (!ownerId) {
        leaveResults.push({ ownerId: '<missing>', tokenId, ok: false, status: 0, error: 'no owner on card' });
        continue;
      }
      try {
        const wallet = ownerId.toLowerCase();
        const res = await draftsApiServer(`/league/${slotId}/actions/leave`, {
          method: 'POST',
          wallet,
          body: { ownerId: wallet, tokenId },
        });
        const ok = res.status >= 200 && res.status < 300;
        leaveResults.push({ ownerId, tokenId, ok, status: res.status });
        logger.info('admin.drafts.manage.delete.leave', {
          requestId,
          slotId,
          ownerId,
          tokenId,
          status: res.status,
          ok,
        });
      } catch (e) {
        leaveResults.push({
          ownerId,
          tokenId,
          ok: false,
          status: 0,
          error: e instanceof Error ? e.message : String(e),
        });
        logger.error('admin.drafts.manage.delete.leave_error', {
          requestId,
          slotId,
          ownerId,
          tokenId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // 2) Delete Firestore subcollections + main doc.
    for (const sub of STATE_SUBCOLS) {
      await db
        .collection('drafts')
        .doc(slotId)
        .collection('state')
        .doc(sub)
        .delete()
        .catch(() => {});
    }
    const remainCards = await db.collection('drafts').doc(slotId).collection('cards').get();
    for (const cd of remainCards.docs) {
      await cd.ref.delete().catch(() => {});
    }
    await db.collection('drafts').doc(slotId).delete();

    // 3) Delete RTDB node.
    await rtdb.ref(`drafts/${slotId}`).remove();

    const refundedCount = leaveResults.filter((r) => r.ok).length;
    const failedLeaves = leaveResults.filter((r) => !r.ok);

    logger.info('admin.drafts.manage.delete.done', {
      requestId,
      slotId,
      cardsTotal: cardsSnap.size,
      refundedCount,
      failedCount: failedLeaves.length,
      durationMs: Date.now() - start,
    });

    return json({
      slotId,
      cardsTotal: cardsSnap.size,
      refundedCount,
      failedLeaves,
      leaveResults,
      requestId,
    });
  } catch (err) {
    logger.error('admin.drafts.manage.delete.failed', {
      requestId,
      slotId,
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Failed to delete draft', 500);
  }
}
