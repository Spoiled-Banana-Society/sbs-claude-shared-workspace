import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/wheel/feed?period=N&limit=50&before=<spinIndex>
 *
 * Public live feed of wheel spins. Returns up to `limit` spins from
 * the given period, ordered newest → oldest. Pass `before` for cursor
 * pagination (older spins).
 *
 * Replaces the old /api/wheel/batches per-100 grouping. Showing every
 * spin individually is free (the verification proofs are off-chain
 * math against a single on-chain Merkle root per period), so there's
 * no reason to batch them.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.wheel);
  if (rateLimited) return rateLimited;
  try {
    const url = new URL(req.url);
    const periodRaw = url.searchParams.get('period');
    const limitRaw = url.searchParams.get('limit');
    const beforeRaw = url.searchParams.get('before');

    const periodNumber = periodRaw ? parseInt(periodRaw, 10) : NaN;
    if (!Number.isInteger(periodNumber) || periodNumber < 1) {
      throw new ApiError(400, 'Missing or invalid `period` query param');
    }

    const limit = limitRaw ? Math.min(200, Math.max(1, parseInt(limitRaw, 10))) : 50;
    const before = beforeRaw ? parseInt(beforeRaw, 10) : null;

    const db = getAdminFirestore();
    let query = db
      .collectionGroup('wheelSpins')
      .where('periodNumber', '==', periodNumber)
      .orderBy('spinIndexInPeriod', 'desc')
      .limit(limit);

    if (before !== null && Number.isInteger(before)) {
      query = db
        .collectionGroup('wheelSpins')
        .where('periodNumber', '==', periodNumber)
        .where('spinIndexInPeriod', '<', before)
        .orderBy('spinIndexInPeriod', 'desc')
        .limit(limit);
    }

    let snap;
    try {
      snap = await query.get();
    } catch (err) {
      // Missing-index errors return FAILED_PRECONDITION. Don't 500 — let
      // the page render an empty feed, surface the failure to the admin
      // error log, and include a hint so the on-call sees the create-index
      // URL in their logs. Without this, the entire /wheel-batches and
      // /proof-feed pages break the moment a new query path is introduced
      // before its composite index exists.
      const msg = (err as { message?: string })?.message ?? String(err);
      const code = (err as { code?: number })?.code;
      if (code === 9 || /FAILED_PRECONDITION|requires an index/i.test(msg)) {
        // logger.error auto-forwards to v2_error_events for admin visibility.
        logger.error('wheel.feed.missing_index', {
          route: '/api/wheel/feed',
          periodNumber,
          err: new Error(msg),
        });
        return json({ periodNumber, count: 0, nextCursor: null, spins: [] }, 200);
      }
      throw err;
    }

    // Grace period: spins older than this auto-count as revealed (covers
    // spins from before confirm-reveal existed + cases where the call
    // failed e.g. tab closed mid-celebration). Mirrors the SSE endpoint.
    const REVEAL_BACKSTOP_MS = 30_000;
    const cutoff = Date.now() - REVEAL_BACKSTOP_MS;
    const spins: Array<{ spinId: string; spinIndex: number; result: string; timestamp: string }> = [];
    for (const d of snap.docs) {
      const data = d.data() as {
        spinId: string;
        result: string;
        timestamp: string;
        spinIndexInPeriod: number;
        feedRevealedAt?: number | null;
      };
      const isExplicitlyRevealed = !!data.feedRevealedAt;
      const isOldEnough = data.timestamp ? new Date(data.timestamp).getTime() < cutoff : false;
      if (!isExplicitlyRevealed && !isOldEnough) continue;
      spins.push({
        spinId: data.spinId,
        spinIndex: data.spinIndexInPeriod,
        result: data.result,
        timestamp: data.timestamp,
      });
      if (spins.length >= limit) break;
    }

    const nextCursor = spins.length === limit ? spins[spins.length - 1].spinIndex : null;

    return json({
      periodNumber,
      count: spins.length,
      nextCursor,
      spins,
    }, 200);
  } catch (err) {
    // logger.error auto-forwards to v2_error_events for admin visibility.
    logger.error('wheel.feed.failed', { route: '/api/wheel/feed', err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
