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

    const snap = await query.get();

    const spins = snap.docs.map((d) => {
      const data = d.data() as {
        spinId: string;
        result: string;
        timestamp: string;
        spinIndexInPeriod: number;
      };
      return {
        spinId: data.spinId,
        spinIndex: data.spinIndexInPeriod,
        result: data.result,
        timestamp: data.timestamp,
      };
    });

    const nextCursor = spins.length === limit ? spins[spins.length - 1].spinIndex : null;

    return json({
      periodNumber,
      count: spins.length,
      nextCursor,
      spins,
    }, 200);
  } catch (err) {
    logger.error('wheel.feed.failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
