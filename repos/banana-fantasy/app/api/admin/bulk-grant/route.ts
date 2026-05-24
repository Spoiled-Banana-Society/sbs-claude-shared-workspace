/**
 * Admin bulk grant — grant N draft passes to many wallets at once.
 *
 * POST /api/admin/bulk-grant
 *   body: { wallets: string[], count: number, reason?: string }
 *
 * Implementation strategy: per-wallet, fan out to the same single-grant
 * endpoint internally. Slower than batching directly but guarantees the
 * audit log + activity feed + on-chain mint behavior stays identical for
 * each grant (so a bulk grant is observationally indistinguishable from
 * N single grants — no special "bulk" path to debug separately).
 *
 * Phase 5 of the admin overhaul (May 2026). Aggregate result reports
 * per-wallet success/failure so partial failures are visible.
 */

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';
import { getRequestId } from '@/lib/requestId';
import { logAdminAction } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

const WALLET_REGEX = /^0x[0-9a-fA-F]{40}$/;
const MAX_BULK = 200;       // safety cap — keep one bulk action bounded
const MAX_COUNT_PER = 50;   // per-wallet pass cap matches single-grant ceiling

interface OneResult {
  wallet: string;
  ok: boolean;
  error?: string;
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  let actorWallet = '';
  try {
    const admin = await requireAdmin(req);
    actorWallet = (admin.walletAddress ?? admin.userId ?? '').toLowerCase();

    const body = await parseBody(req);
    const walletsRaw = Array.isArray(body.wallets) ? body.wallets : null;
    if (!walletsRaw) throw new ApiError(400, 'wallets: array required');
    const wallets = walletsRaw
      .map((w: unknown) => String(w ?? '').trim().toLowerCase())
      .filter((w: string) => WALLET_REGEX.test(w));
    if (wallets.length === 0) throw new ApiError(400, 'no valid wallets in list');
    if (wallets.length > MAX_BULK) {
      throw new ApiError(400, `too many wallets — max ${MAX_BULK} per request`);
    }
    const count = Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT_PER) {
      throw new ApiError(400, `count must be an integer 1..${MAX_COUNT_PER}`);
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';

    // Use the same auth header the caller sent us — passes the admin's
    // identity through to the underlying single-grant endpoint so its
    // own requireAdmin succeeds + audit shows the correct actor.
    const authHeader = req.headers.get('authorization') ?? '';
    const origin = new URL(req.url).origin;
    const grantUrl = `${origin}/api/admin/grant-drafts`;

    const results: OneResult[] = [];
    let okCount = 0;
    let failCount = 0;
    for (const wallet of wallets) {
      try {
        const res = await fetch(grantUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', authorization: authHeader },
          body: JSON.stringify({ wallet, count, reason: reason || 'bulk-grant' }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          results.push({ wallet, ok: false, error: `${res.status}: ${errBody.slice(0, 120)}` });
          failCount += 1;
        } else {
          results.push({ wallet, ok: true });
          okCount += 1;
        }
      } catch (err) {
        results.push({ wallet, ok: false, error: err instanceof Error ? err.message : String(err) });
        failCount += 1;
      }
    }

    await logAdminAction({
      requestId,
      actor: actorWallet,
      action: 'admin-bulk-grant',
      target: `wallets:${wallets.length}`,
      after: { count, reason, okCount, failCount, walletCount: wallets.length },
    });

    logger.info('admin.bulk_grant.completed', {
      actor: actorWallet,
      route: 'admin/bulk-grant',
      context: { count, walletCount: wallets.length, okCount, failCount, reason },
    });

    return json({
      ok: failCount === 0,
      requested: wallets.length,
      okCount,
      failCount,
      results,
      requestId,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status, { requestId });
    logger.error('admin.bulk_grant.failed', {
      err: err instanceof Error ? err : String(err),
      route: 'admin/bulk-grant',
      actor: actorWallet,
    });
    return jsonError('Internal Server Error', 500, { requestId });
  }
}
