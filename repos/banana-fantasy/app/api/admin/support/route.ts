import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { listConversations, crispConversationUrl, crispInboxUrl } from '@/lib/crispApi';
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

    const { conversations, configured, authFailed } = await listConversations({
      filterUnread: filter === 'unread',
      filterResolved: filter === 'open' ? false : undefined,
    });

    const enriched = conversations.map((c) => ({
      ...c,
      url: crispConversationUrl(c.session_id),
    }));

    logger.info('admin.support.ok', {
      requestId,
      configured,
      count: enriched.length,
      durationMs: Date.now() - start,
    });

    return json({
      conversations: enriched,
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
