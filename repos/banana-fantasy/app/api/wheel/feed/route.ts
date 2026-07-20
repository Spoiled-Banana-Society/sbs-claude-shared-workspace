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
  // Read route polled by the wheel page — general limit (60/min), not the
  // tight spin bucket, so polling doesn't eat the user's spin budget.
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const url = new URL(req.url);
    const periodRaw = url.searchParams.get('period');
    const limitRaw = url.searchParams.get('limit');
    const beforeRaw = url.searchParams.get('before');
    const beforeTsRaw = url.searchParams.get('beforeTs');

    const limit = limitRaw ? Math.min(200, Math.max(1, parseInt(limitRaw, 10))) : 50;

    // ALL-TIME mode (`period=all` or omitted): every spin since the contest
    // started, across every VRF round AND the pre-round era, ordered by
    // timestamp. This is what the public feed shows — rolling to a new VRF
    // round must never make historical spins disappear. Cursor is the ISO
    // timestamp of the last row (`beforeTs`).
    if (!periodRaw || periodRaw === 'all') {
      return await allTimeFeed(limit, beforeTsRaw);
    }

    const periodNumber = parseInt(periodRaw, 10);
    if (!Number.isInteger(periodNumber) || periodNumber < 1) {
      throw new ApiError(400, 'Invalid `period` query param');
    }

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

/**
 * All-time spin feed: collection-group over every user's wheelSpins ordered
 * by timestamp (ISO strings sort chronologically). Rows carry their round
 * number + in-round index when they have one (VRF-era spins are verifiable);
 * pre-round spins render without a proof link. Same reveal-grace filtering
 * as the per-round mode.
 */
async function allTimeFeed(limit: number, beforeTs: string | null): Promise<Response> {
  const db = getAdminFirestore();
  let query = db
    .collectionGroup('wheelSpins')
    .orderBy('timestamp', 'desc')
    .limit(limit * 2);
  if (beforeTs) {
    query = db
      .collectionGroup('wheelSpins')
      .orderBy('timestamp', 'desc')
      .startAfter(beforeTs)
      .limit(limit * 2);
  }

  let snap;
  try {
    snap = await query.get();
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    const code = (err as { code?: number })?.code;
    if (code === 9 || /FAILED_PRECONDITION|requires an index/i.test(msg)) {
      logger.error('wheel.feed.missing_index', { route: '/api/wheel/feed', mode: 'all', err: new Error(msg) });
      return json({ periodNumber: null, count: 0, nextCursor: null, nextCursorTs: null, spins: [] }, 200);
    }
    throw err;
  }

  const REVEAL_BACKSTOP_MS = 30_000;
  const cutoff = Date.now() - REVEAL_BACKSTOP_MS;
  const spins: Array<{
    spinId: string;
    spinIndex: number | null;
    periodNumber: number | null;
    result: string;
    timestamp: string;
  }> = [];
  for (const d of snap.docs) {
    const data = d.data() as {
      spinId?: string;
      result?: string;
      timestamp?: string;
      periodNumber?: number | null;
      spinIndexInPeriod?: number | null;
      feedRevealedAt?: number | null;
    };
    if (!data.spinId || !data.result || !data.timestamp) continue;
    const isExplicitlyRevealed = !!data.feedRevealedAt;
    const isOldEnough = new Date(data.timestamp).getTime() < cutoff;
    if (!isExplicitlyRevealed && !isOldEnough) continue;
    spins.push({
      spinId: data.spinId,
      spinIndex: typeof data.spinIndexInPeriod === 'number' ? data.spinIndexInPeriod : null,
      periodNumber: typeof data.periodNumber === 'number' ? data.periodNumber : null,
      result: data.result,
      timestamp: data.timestamp,
    });
    if (spins.length >= limit) break;
  }

  const nextCursorTs = spins.length === limit ? spins[spins.length - 1].timestamp : null;
  return json({ periodNumber: null, count: spins.length, nextCursor: null, nextCursorTs, spins }, 200);
}
