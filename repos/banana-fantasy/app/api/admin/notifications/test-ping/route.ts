/**
 * POST /api/admin/notifications/test-ping
 * Body: { wallet }
 *
 * Admin-only "fire a test notification at this wallet" endpoint.
 *
 * Why this exists instead of letting the admin UI call
 * /api/notifications/draft-filled directly: that route is gated by an
 * INTERNAL_SECRET (server-to-server only) which must not be exposed in
 * client bundles. This route lets the admin UI fire test pings using
 * standard admin auth (Privy bearer) and runs the dispatch logic
 * server-side. Returns per-channel results with recipient counts so
 * the UI can show `push: sent (recipients: 2)` etc.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getRequestId } from '@/lib/requestId';
import { logger } from '@/lib/logger';
import { deliverToRecipient } from '@/lib/notifications/deliver';

export const dynamic = 'force-dynamic';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = (admin.walletAddress ?? admin.userId ?? '').toLowerCase();

    const body = await parseBody(req);
    const wallet = requireString(body.wallet, 'wallet').toLowerCase();
    if (!WALLET_REGEX.test(wallet)) throw new ApiError(400, 'wallet must be 40-hex');

    // Unique draftId so the dedup store doesn't block a re-run.
    const event = {
      type: 'draft.filled' as const,
      draftId: `admin-test-${Date.now()}`,
      draftName: 'Admin test — channel check',
    };

    const report = await deliverToRecipient(wallet, event);
    return json({ ok: true, report, requestId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.notifications.test_ping_failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/notifications/test-ping',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
