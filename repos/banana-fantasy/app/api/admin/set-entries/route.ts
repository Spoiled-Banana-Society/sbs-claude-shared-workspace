import { getAdminFirestore } from '@/lib/firebaseAdmin';
export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';

const USERS_COLLECTION = 'v2_users';

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req);
    const userId = body.userId as string;
    const jackpotEntries = typeof body.jackpotEntries === 'number' ? body.jackpotEntries : undefined;
    const hofEntries = typeof body.hofEntries === 'number' ? body.hofEntries : undefined;
    const wheelSpins = typeof body.wheelSpins === 'number' ? body.wheelSpins : undefined;

    if (!userId) throw new ApiError(400, 'Missing userId');

    const db = getAdminFirestore();
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const beforeSnap = await userRef.get();
    const before = beforeSnap.data() ?? {};

    const patch: Record<string, number> = {};
    if (jackpotEntries !== undefined) patch.jackpotEntries = jackpotEntries;
    if (hofEntries !== undefined) patch.hofEntries = hofEntries;
    if (wheelSpins !== undefined) patch.wheelSpins = wheelSpins;

    await userRef.set(patch, { merge: true });

    await logAdminAction({
      actor,
      action: 'set-entries',
      target: userId,
      before: {
        jackpotEntries: before.jackpotEntries,
        hofEntries: before.hofEntries,
        wheelSpins: before.wheelSpins,
      },
      after: patch,
      requestId,
    });

    logger.info('admin.set_entries.ok', { requestId, actor, target: userId, patch, durationMs: Date.now() - start });
    return json({ success: true, patch, requestId });
  } catch (err) {
    logger.error('admin.set_entries.failed', { requestId, actor, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}

export async function DELETE(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  let actor = '';
  try {
    const admin = await requireAdmin(req);
    actor = admin.walletAddress ?? admin.userId;

    const db = getAdminFirestore();
    const ids = ['jackpot', 'hof', 'jackhof'];
    for (const id of ids) {
      await db.collection('v2_queues').doc(id).set({ type: id, rounds: [], nextRoundId: 1 });
    }

    await logAdminAction({
      actor,
      action: 'reset-queue',
      target: 'queues',
      after: { reset: ids },
      requestId,
    });

    logger.info('admin.reset_queue.ok', { requestId, actor, ids, durationMs: Date.now() - start });
    return json({ success: true, reset: ids, requestId });
  } catch (err) {
    logger.error('admin.reset_queue.failed', { requestId, actor, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
