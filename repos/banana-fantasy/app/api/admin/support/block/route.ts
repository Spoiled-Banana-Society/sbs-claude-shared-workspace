import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { setConversationBlocked } from '@/lib/crispApi';
import { logAdminAction } from '@/lib/adminAudit';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/support/block  { sessionId, blocked }
 * Blocks (or unblocks) the visitor behind a Crisp conversation — Crisp's own
 * "Block user", so nothing from them reaches the inbox on ANY channel.
 * Pairs with v2_users.supportBlocked (which only hides the widget on-site).
 */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    const admin = await requireAdmin(req);
    const actor = admin.walletAddress ?? admin.userId;
    const body = await parseBody<{ sessionId?: string; blocked?: boolean }>(req);
    const sessionId = String(body.sessionId ?? '').trim();
    if (!/^session_[A-Za-z0-9-]+$/.test(sessionId)) throw new ApiError(400, 'Invalid sessionId');
    const blocked = body.blocked !== false;
    const r = await setConversationBlocked(sessionId, blocked);
    if (!r.ok) throw new ApiError(r.status === 401 ? 502 : 502, `Crisp refused (${r.status}) ${r.body ?? ''}`.trim());
    await logAdminAction({ actor, action: blocked ? 'crisp-block-user' : 'crisp-unblock-user', target: sessionId, before: {}, after: { blocked }, requestId });
    logger.info('admin.support.block.ok', { requestId, actor, sessionId, blocked });
    return json({ ok: true, sessionId, blocked });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.support.block.failed', { requestId, err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
