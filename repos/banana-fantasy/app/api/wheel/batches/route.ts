import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/wheel/batches?period=N&batchIndex=I
 *
 * Public read of a 100-spin "batch receipt". A batch is a 100-spin
 * window within a period — periodN=1, batchIndex=0 covers spins 0..99,
 * batchIndex=1 covers 100..199, etc. Each batch lists every spin in it
 * with its result, timestamp, and a link to the per-spin proof page.
 *
 * Used by the /wheel-batches page to display rolling public receipts.
 */
export async function GET(req: Request) {
  // Public read for the batches page — general limit (60/min), not the tight
  // spin bucket.
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const url = new URL(req.url);
    const periodRaw = url.searchParams.get('period');
    const batchRaw = url.searchParams.get('batchIndex');
    const periodNumber = periodRaw ? parseInt(periodRaw, 10) : NaN;
    const batchIndex = batchRaw ? parseInt(batchRaw, 10) : NaN;
    if (!Number.isInteger(periodNumber) || periodNumber < 1) {
      throw new ApiError(400, 'Missing or invalid `period` query param');
    }
    if (!Number.isInteger(batchIndex) || batchIndex < 0) {
      throw new ApiError(400, 'Missing or invalid `batchIndex` query param');
    }

    const startIdx = batchIndex * 100;
    const endIdx = startIdx + 99;

    const db = getAdminFirestore();
    const snap = await db
      .collectionGroup('wheelSpins')
      .where('periodNumber', '==', periodNumber)
      .where('spinIndexInPeriod', '>=', startIdx)
      .where('spinIndexInPeriod', '<=', endIdx)
      .orderBy('spinIndexInPeriod', 'asc')
      .get();

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

    return json({
      periodNumber,
      batchIndex,
      startIndex: startIdx,
      endIndex: endIdx,
      count: spins.length,
      complete: spins.length === 100,
      spins,
    }, 200);
  } catch (err) {
    logger.error('wheel.batches.failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
