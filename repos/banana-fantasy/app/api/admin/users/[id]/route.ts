import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';
import { clearBanCache } from '@/lib/banCheck';
import { isWalletAdmin } from '@/lib/adminAllowlist';

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
    if (!id) throw new ApiError(400, 'Missing user id');

    const body = await parseBody<{ banned?: boolean; draftBlocked?: boolean }>(req);

    // Drafting-only block (Boris 2026-08-18): { draftBlocked: boolean } — the
    // account keeps working (teams, winnings, login) but every draft-entry
    // path on the site refuses. Softer than banned; see lib/draftBlock.ts.
    if (typeof body.draftBlocked === 'boolean' && typeof body.banned !== 'boolean') {
      if (body.draftBlocked && isWalletAdmin(id)) throw new ApiError(400, 'Cannot draft-block an admin wallet');
      const db = getAdminFirestore();
      const ref = db.collection('v2_users').doc(id);
      const doc = await ref.get();
      if (!doc.exists) throw new ApiError(404, 'User not found');
      const before = doc.data()?.draftBlocked === true;
      await ref.set({ draftBlocked: body.draftBlocked, draftBlockedAt: body.draftBlocked ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }, { merge: true });
      await logAdminAction({ actor, action: body.draftBlocked ? 'draft-block-user' : 'draft-unblock-user', target: id, before: { draftBlocked: before }, after: { draftBlocked: body.draftBlocked }, requestId });
      logger.info('admin.user_draft_block.ok', { requestId, actor, target: id, draftBlocked: body.draftBlocked });
      return json({ ok: true, id, draftBlocked: body.draftBlocked });
    }

    if (typeof body.banned !== 'boolean') throw new ApiError(400, 'Expected { banned: boolean } or { draftBlocked: boolean }');

    // Safety: admin wallets can't be banned — prevents accidental self/peer lockout.
    if (body.banned && isWalletAdmin(id)) {
      throw new ApiError(400, 'Cannot ban an admin wallet');
    }

    const db = getAdminFirestore();
    for (const col of ['users', 'v2_users']) {
      const ref = db.collection(col).doc(id);
      const doc = await ref.get();
      if (doc.exists) {
        const before = doc.data() ?? {};
        await ref.set({ banned: body.banned, updatedAt: new Date().toISOString() }, { merge: true });
        const updated = await ref.get();
        const data = updated.data() ?? {};

        // Invalidate ban cache immediately so status takes effect without TTL wait
        clearBanCache(id);

        await logAdminAction({
          actor,
          action: body.banned ? 'ban-user' : 'unban-user',
          target: id,
          before: { banned: before.banned === true },
          after: { banned: data.banned === true },
          requestId,
        });

        logger.info('admin.user_ban.ok', {
          requestId,
          actor,
          target: id,
          banned: body.banned,
          durationMs: Date.now() - start,
        });

        return json({
          id: updated.id,
          walletAddress: data.walletAddress || '',
          banned: data.banned === true,
          email: data.blueCheckEmail || data.email || null,
          requestId,
        });
      }
    }

    throw new ApiError(404, 'User not found');
  } catch (err) {
    logger.error('admin.user_ban.failed', { requestId, actor, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
