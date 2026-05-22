import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/sentry-issues/{issueId}/resolve
 *
 * Marks a Sentry issue as resolved via the Sentry API, eliminating it
 * from the admin Frontend Errors badge permanently. Beats the in-admin
 * "mark as read" pattern (which only updates the user's lastSeen; new
 * Sentry events for the same issue re-fire the badge).
 *
 * Calls PUT https://sentry.io/api/0/issues/{issueId}/?status=resolved
 * with the project's SENTRY_AUTH_TOKEN (already configured for fetch).
 */
export async function POST(req: Request, ctx: { params: { issueId: string } }) {
  const requestId = getRequestId(req);
  const start = Date.now();
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const issueId = ctx.params.issueId?.trim();
    if (!issueId) throw new ApiError(400, 'Missing issueId');
    if (!/^\d+$/.test(issueId)) throw new ApiError(400, 'issueId must be numeric');

    const token = process.env.SENTRY_AUTH_TOKEN;
    if (!token) throw new ApiError(503, 'SENTRY_AUTH_TOKEN not configured');

    const sentryRes = await fetch(
      `https://sentry.io/api/0/issues/${encodeURIComponent(issueId)}/`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'resolved' }),
      },
    );

    if (!sentryRes.ok) {
      const text = await sentryRes.text().catch(() => '');
      logger.warn('admin.sentry.resolve_failed', {
        requestId,
        issueId,
        status: sentryRes.status,
        body: text.slice(0, 200),
        durationMs: Date.now() - start,
      });
      return jsonError(`Sentry API ${sentryRes.status}`, 502, { requestId });
    }

    logger.info('admin.sentry.resolve_ok', { requestId, issueId, durationMs: Date.now() - start });
    return json({ ok: true, issueId, requestId });
  } catch (err) {
    logger.error('admin.sentry.resolve_failed', {
      route: '/api/admin/sentry-issues/[issueId]/resolve',
      requestId,
      err,
      durationMs: Date.now() - start,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
