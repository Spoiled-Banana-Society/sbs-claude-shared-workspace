import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  OPENSEA_CHAIN,
  BBB4_CONTRACT,
  COLLECTION_SLUG,
  mapOpenSeaListingToTeam,
  type OpenSeaListing,
  type OpenSeaNft,
} from '@/lib/opensea';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * GET /api/marketplace/listings?sort=price&direction=asc&limit=50&cursor=...
 *
 * Returns active BBB4 listings from OpenSea's Seaport orderbook on Base.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const _sort = getSearchParam(req, 'sort') || 'eth_price';
    const _direction = getSearchParam(req, 'direction') || 'asc';
    const limit = Math.min(Number(getSearchParam(req, 'limit')) || 50, 50);
    const cursor = getSearchParam(req, 'cursor');

    const params = new URLSearchParams({
      limit: String(limit),
    });
    if (cursor) params.set('next', cursor);

    // Use collection-level listings endpoint (works across all protocols)
    const listingsRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?${params}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        cache: 'no-store',
      },
    );

    if (!listingsRes.ok) {
      const text = await listingsRes.text();
      console.error('[marketplace/listings] OpenSea error:', listingsRes.status, text);
      return jsonError('Failed to fetch listings', listingsRes.status >= 500 ? 502 : listingsRes.status);
    }

    const listingsData = await listingsRes.json();
    const orders: OpenSeaListing[] = listingsData.listings ?? [];

    // Extract token IDs from listings to batch-fetch NFT metadata
    const tokenIds = orders.map(o => {
      const nftOffer = o.protocol_data.parameters.offer.find(
        (item: { itemType: number }) => item.itemType === 2 || item.itemType === 3,
      );
      return nftOffer?.identifierOrCriteria ?? '0';
    });

    // Fetch NFT metadata for each token (batch via Promise.all, max 50)
    const nftMap = new Map<string, OpenSeaNft>();
    if (tokenIds.length > 0) {
      const uniqueTokenIds = [...new Set(tokenIds)];
      const nftFetches = uniqueTokenIds.map(async (tokenId) => {
        try {
          const nftRes = await fetch(
            `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}`,
            {
              headers: {
                accept: 'application/json',
                'x-api-key': OPENSEA_API_KEY,
              },
              next: { revalidate: 300 },
            },
          );
          if (nftRes.ok) {
            const nftData = await nftRes.json();
            if (nftData.nft) {
              nftMap.set(tokenId, nftData.nft);
            }
          }
        } catch {
          // Silent — skip metadata for this token
        }
      });
      await Promise.all(nftFetches);
    }

    const allListings = orders.map(order => {
      const tokenId = tokenIds[orders.indexOf(order)];
      const nft = nftMap.get(tokenId) ?? null;
      return mapOpenSeaListingToTeam(order, nft);
    });

    // Deduplicate — keep only the first (most recent) listing per team
    const seen = new Set<string>();
    const listings = allListings.filter(listing => {
      if (seen.has(listing.name)) return false;
      seen.add(listing.name);
      return true;
    });

    // Enrich with SBS owner profiles (name + pfp) — best-effort with timeout
    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
    try {
      const uniqueOwners = [...new Set(listings.map(l => l.ownerAddress.toLowerCase()))];
      const ownerProfiles = new Map<string, { name: string; pfp: string | null }>();

      const enrichWithTimeout = Promise.all(
        uniqueOwners.map(async (addr) => {
          try {
            const res = await fetch(`${DRAFTS_API}/owner/${addr}`, {
              signal: AbortSignal.timeout(2500),
            });
            if (!res.ok) return;
            const profile = await res.json();
            if (profile?.pfp?.displayName || profile?.pfp?.imageUrl) {
              ownerProfiles.set(addr, {
                name: profile.pfp?.displayName || '',
                pfp: profile.pfp?.imageUrl || null,
              });
            }
          } catch { /* skip */ }
        }),
      );

      await enrichWithTimeout;

      for (const listing of listings) {
        const profile = ownerProfiles.get(listing.ownerAddress.toLowerCase());
        if (profile) {
          if (profile.name) listing.owner = profile.name;
          if (profile.pfp) listing.ownerPfp = profile.pfp;
        }
      }
    } catch { /* enrichment failed — continue with raw data */ }

    return json({
      listings,
      next: listingsData.next ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/listings] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
