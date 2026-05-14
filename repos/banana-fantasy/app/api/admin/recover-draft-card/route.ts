import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';

/**
 * POST /api/admin/recover-draft-card
 *
 * Body: { draftId: string, walletAddress: string }
 *
 * Re-runs the per-card close-draft flow for one user. Used when the original
 * close-draft partially failed (image-gen 500, network blip, etc) and a card
 * is stuck with a default placeholder image or empty roster. Idempotent —
 * safe to call repeatedly.
 *
 * Auth: requires admin session (same pattern as other /api/admin/* routes).
 * Calls the Go API admin endpoint with X-Admin-Key for the inter-service
 * call.
 *
 * Also called by the daily reconciliation cron (`/api/crons/reconcile-stuck-cards`)
 * via the same Go endpoint, so this Next.js route is for the human-in-the-loop
 * path (admin UI button + manual recoveries).
 */

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const DRAFTS_API_URL =
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = admin.walletAddress ?? admin.userId;

    const body = await parseBody(req);
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    const walletAddress =
      typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : '';

    if (!draftId) throw new ApiError(400, 'draftId is required');
    if (!walletAddress || !WALLET_REGEX.test(walletAddress)) {
      throw new ApiError(400, 'walletAddress must be a 0x-prefixed 40-hex-char address');
    }

    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      logger.error('admin.recover_card.no_admin_key', { requestId });
      throw new ApiError(503, 'ADMIN_API_KEY not configured');
    }

    const url = `${DRAFTS_API_URL.replace(/\/$/, '')}/draft-actions/${encodeURIComponent(
      draftId,
    )}/owner/${encodeURIComponent(walletAddress)}/admin/recover-card`;

    logger.info('admin.recover_card.request', { requestId, actor: actorWallet, draftId, walletAddress });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey,
      },
      // The Go endpoint takes no body — all needed inputs are URL params.
      body: '{}',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('admin.recover_card.upstream_failed', {
        requestId,
        actor: actorWallet,
        draftId,
        walletAddress,
        status: res.status,
        body: text.slice(0, 500),
      });
      throw new ApiError(res.status === 404 ? 404 : 500, `recover failed: ${text.slice(0, 200)}`);
    }

    await logAdminAction({
      action: 'recover-draft-card',
      actor: actorWallet,
      target: walletAddress,
      requestId,
      after: { draftId },
    });

    logger.info('admin.recover_card.success', { requestId, actor: actorWallet, draftId, walletAddress });
    return json({ ok: true, draftId, walletAddress }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.recover_card.failed', { requestId, actor: actorWallet, err });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
