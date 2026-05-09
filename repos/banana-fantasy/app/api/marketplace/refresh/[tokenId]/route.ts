import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT } from '@/lib/opensea';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * POST /api/marketplace/refresh/[tokenId]
 *
 * Asks OpenSea to re-fetch metadata for a single BBB4 token. Use when
 * traits look stale (e.g. LEAGUE-NAME missing on a token whose draft
 * has long completed). OpenSea queues the refresh asynchronously, so
 * the caller should wait a few seconds before re-fetching the NFT.
 */
export async function POST(
  req: Request,
  { params }: { params: { tokenId: string } },
) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const { tokenId } = params;
    if (!tokenId || !/^\d+$/.test(tokenId)) {
      return jsonError('Invalid tokenId', 400);
    }

    const refreshUrl = `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}/refresh`;
    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-api-key': OPENSEA_API_KEY,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[marketplace/refresh] OpenSea refresh failed:', res.status, text);
      return jsonError('Failed to queue metadata refresh', res.status >= 500 ? 502 : res.status);
    }

    return json({ ok: true, tokenId });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/refresh] failed', err);
    return jsonError('Internal Server Error', 500);
  }
}
