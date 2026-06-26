import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { listConversations, crispConversationUrl, crispInboxUrl } from '@/lib/crispApi';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

// Ground-truth "who spoke last" per conversation, read from our own Crisp
// webhook log (crisp_webhook_events — written by /api/crisp/webhook). This is
// independent of Crisp's per-operator unread counter, which is keyed to the
// API-token operator (not the human who reads/replies in the Crisp dashboard)
// and therefore never clears for us. Map: sessionId -> latest {from, nickname}.
async function lastMessageBySession(): Promise<Map<string, { from: string | null; nickname: string | null }>> {
  const map = new Map<string, { from: string | null; nickname: string | null }>();
  try {
    const db = getAdminFirestore();
    // Newest first; first time we see a sessionId is its latest event.
    const snap = await db.collection('crisp_webhook_events').orderBy('at', 'desc').limit(500).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const sid = typeof d.sessionId === 'string' ? d.sessionId : '';
      if (!sid || map.has(sid)) continue;
      map.set(sid, {
        from: typeof d.from === 'string' ? d.from : null,
        nickname: typeof d.nickname === 'string' && d.nickname ? d.nickname : null,
      });
    }
  } catch {
    // Non-fatal — fall back to Crisp's unread counter below.
  }
  return map;
}

function unreadOperatorCount(u: { operator?: number; visitor?: number } | number): number {
  if (typeof u === 'number') return u;
  return u?.operator ?? 0;
}

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const filter = url.searchParams.get('filter') ?? 'all'; // 'all' | 'unread' | 'open'

    // Fetch broadly and filter in-code using our own last-message-direction
    // signal (below). We no longer hand 'unread' to Crisp's filter_unread —
    // that counter never clears for our token, which is the bug. For 'open' we
    // still ask Crisp for unresolved-only (a real, reliable conversation state).
    const { conversations, configured, authFailed } = await listConversations({
      filterResolved: filter === 'open' ? false : undefined,
    });

    const lastBySession = await lastMessageBySession();

    const enriched = conversations.map((c) => {
      const rec = lastBySession.get(c.session_id);
      // needsReply = the user spoke last (still awaiting our reply). Ground
      // truth from our webhook log; if we have no record for this conversation
      // (e.g. older than the log), fall back to Crisp's unread counter.
      const needsReply = rec?.from
        ? rec.from === 'user'
        : unreadOperatorCount(c.unread) > 0;
      const displayName = c.nickname || c.email || rec?.nickname || 'Anonymous';
      return {
        ...c,
        url: crispConversationUrl(c.session_id),
        displayName,
        needsReply,
      };
    });

    // Apply the tab filter with OUR signals, not Crisp's flaky unread counter.
    const filtered = enriched.filter((c) => {
      if (filter === 'unread') return c.needsReply;
      if (filter === 'open') return c.state !== 'resolved';
      return true;
    });

    logger.info('admin.support.ok', {
      requestId,
      configured,
      filter,
      count: filtered.length,
      durationMs: Date.now() - start,
    });

    return json({
      conversations: filtered,
      configured,
      authFailed: authFailed ?? false,
      inboxUrl: crispInboxUrl(),
      requestId,
    });
  } catch (err) {
    logger.error('admin.support.failed', { requestId, err, durationMs: Date.now() - start });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
