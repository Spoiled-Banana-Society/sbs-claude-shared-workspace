export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';

/**
 * POST /api/marketplace/offers/consumed  · Body: { orderHash }
 *
 * Mark a cached offer dead once it's been accepted or cancelled, so the offer
 * cache doesn't keep surfacing it during OpenSea's indexing lag.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const orderHash = requireString(body.orderHash, 'orderHash');
    const tokenId = typeof body.tokenId === 'string' ? body.tokenId : undefined;
    const { recordOfferConsumed } = await import('@/lib/marketplace/offerCache');
    await recordOfferConsumed(orderHash, tokenId);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
