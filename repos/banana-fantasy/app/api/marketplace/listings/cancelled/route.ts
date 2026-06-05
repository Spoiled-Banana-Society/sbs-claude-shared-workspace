import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { recordCancelled } from '@/lib/marketplace/listingCache';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketplace/listings/cancelled
 * Body: { tokenId, wallet }
 *
 * Called by the client AFTER an on-chain cancel tx confirms, so the listing
 * cache reflects the delist instantly (the marketplace doesn't wait on OpenSea
 * to drop the order from its index).
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const tokenId = requireString(body.tokenId, 'tokenId');
    const wallet = requireString(body.wallet, 'wallet');
    await recordCancelled(tokenId, wallet);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/listings/cancelled] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
