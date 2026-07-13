import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { listConversations, crispInboxUrl } from '@/lib/crispApi';
import { lastMessageBySession, enrichSupportConversation } from '@/lib/crispSupport';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

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

    const enriched = conversations.map((c) =>
      enrichSupportConversation(c, lastBySession.get(c.session_id)),
    );

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
