import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/offers/mine?address=0x…
 *
 * Active offers the wallet has made, from our own offer cache — instant, no
 * OpenSea round-trip. Drives the "Your offer $X" chip on marketplace cards so
 * a bidder can see at a glance which teams they already have offers on.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const address = getSearchParam(req, 'address');
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return jsonError('Missing or invalid address parameter', 400);
    }

    const { getCachedOffersByOfferer } = await import('@/lib/marketplace/offerCache');
    const cached = await getCachedOffersByOfferer(address);
    const offers = cached.map(c => ({
      tokenId: c.tokenId,
      priceUsd: c.priceUsd,
      orderHash: c.orderHash,
      endTimeSec: c.endTimeSec,
    }));

    return json({ offers });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/offers/mine] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
