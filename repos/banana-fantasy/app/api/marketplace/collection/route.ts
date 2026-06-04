import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, COLLECTION_SLUG, type OpenSeaListing } from '@/lib/opensea';
import { getEthUsd, isEthSymbol } from '@/lib/marketplace/ethPrice';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/** Count total active listings by paginating through OpenSea's listings endpoint. */
async function countActiveListings(): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  const maxPages = 20; // Safety limit

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('next', cursor);

    const res = await fetch(
      `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?${params}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        cache: 'no-store',
      },
    );

    if (!res.ok) break;

    const data = await res.json();
    const listings: OpenSeaListing[] = data.listings ?? [];
    total += listings.length;
    cursor = data.next ?? null;
    if (!cursor || listings.length === 0) break;
  }

  return total;
}

/**
 * GET /api/marketplace/collection
 *
 * Returns collection stats (floor price, volume, owners, sales) from OpenSea.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    // Fetch stats and total listed count in parallel
    const [statsRes, totalListed] = await Promise.all([
      fetch(
        `${OPENSEA_API_BASE}/api/v2/collections/${COLLECTION_SLUG}/stats`,
        {
          headers: {
            accept: 'application/json',
            'x-api-key': OPENSEA_API_KEY,
          },
          next: { revalidate: 60 },
        },
      ),
      countActiveListings(),
    ]);

    if (!statsRes.ok) {
      const text = await statsRes.text();
      console.error('[marketplace/collection] OpenSea error:', statsRes.status, text);
      return jsonError('Failed to fetch collection stats', statsRes.status >= 500 ? 502 : statsRes.status);
    }

    const data = await statsRes.json();
    const total = data.total ?? {};
    const intervals = data.intervals ?? [];

    // Find the weekly interval for change stats
    const weekInterval = intervals.find((i: { interval: string }) => i.interval === 'one_week');

    // Floor/volume/avg come back in the floor listing's currency. Our listings
    // are USDC (≈$1), but if the cheapest listing is ETH-priced, convert to USD
    // so the UI can always render a real dollar figure. If the rate lookup
    // fails (ethUsd = 0) we leave the native ETH values + symbol untouched.
    let floorPrice = total.floor_price ?? 0;
    let totalVolume = total.volume ?? 0;
    let averagePrice = total.average_price ?? 0;
    let marketCap = total.market_cap ?? 0;
    let displaySymbol = total.floor_price_symbol ?? 'USDC';
    if (isEthSymbol(displaySymbol)) {
      const ethUsd = await getEthUsd();
      if (ethUsd > 0) {
        floorPrice *= ethUsd;
        totalVolume *= ethUsd;
        averagePrice *= ethUsd;
        marketCap *= ethUsd;
        displaySymbol = 'USD';
      }
    }

    return json({
      floorPrice,
      floorPriceSymbol: displaySymbol,
      totalVolume,
      numOwners: total.num_owners ?? 0,
      totalSales: total.sales ?? 0,
      totalListed,
      averagePrice,
      marketCap,
      weeklyVolumeChange: weekInterval?.volume_change ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/collection] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
