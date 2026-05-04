import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  COLLECTION_SLUG,
  mapOpenSeaNftToTeam,
  type OpenSeaNft,
  type OpenSeaListing,
} from '@/lib/opensea';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * GET /api/marketplace/collection-nfts?limit=50&cursor=...
 *
 * Returns ALL NFTs in the BBB4 collection (listed and unlisted).
 * Each NFT includes listing info if currently listed.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const limit = Math.min(Number(getSearchParam(req, 'limit')) || 50, 50);
    const cursor = getSearchParam(req, 'cursor');

    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('next', cursor);

    // Fetch ALL NFTs in the collection
    const nftsRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/collection/${COLLECTION_SLUG}/nfts?${params}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        cache: 'no-store',
      },
    );

    if (!nftsRes.ok) {
      const text = await nftsRes.text();
      console.error('[marketplace/collection-nfts] OpenSea error:', nftsRes.status, text);
      return jsonError('Failed to fetch NFTs', nftsRes.status >= 500 ? 502 : nftsRes.status);
    }

    const nftsData = await nftsRes.json();
    // Filter out token 0 — it's a placeholder, not a real NFT
    const rawNfts: OpenSeaNft[] = (nftsData.nfts ?? []).filter(
      (nft: OpenSeaNft) => nft.identifier !== '0',
    );

    // Also fetch active listings to cross-reference which are listed
    const listingsMap = new Map<string, OpenSeaListing>();
    try {
      const listingsRes = await fetch(
        `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
        {
          headers: {
            accept: 'application/json',
            'x-api-key': OPENSEA_API_KEY,
          },
          cache: 'no-store',
        },
      );
      if (listingsRes.ok) {
        const listingsData = await listingsRes.json();
        for (const listing of (listingsData.listings ?? [])) {
          const nftOffer = listing.protocol_data.parameters.offer.find(
            (o: { itemType: number }) => o.itemType === 2 || o.itemType === 3,
          );
          const tid = nftOffer?.identifierOrCriteria;
          if (tid) listingsMap.set(tid, listing);
        }
      }
    } catch { /* silent — listings are enrichment */ }

    // Map NFTs to MarketplaceTeam format, enriching with listing data
    const nfts = rawNfts.map(nft => {
      const team = mapOpenSeaNftToTeam(nft, '');
      const listing = listingsMap.get(nft.identifier);
      if (listing) {
        const value = listing.price?.current?.value;
        const decimals = listing.price?.current?.decimals ?? 18;
        team.price = value ? Number(value) / Math.pow(10, decimals) : null;
        team.orderHash = listing.order_hash;
        team.protocolAddress = listing.protocol_address;
        team.ownerAddress = listing.protocol_data.parameters.offerer;
        team.owner = `${team.ownerAddress.slice(0, 6)}...${team.ownerAddress.slice(-4)}`;
      }
      return team;
    });

    // Enrich with SBS owner profiles
    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
    try {
      const uniqueOwners = [...new Set(nfts.filter(n => n.ownerAddress).map(n => n.ownerAddress.toLowerCase()))];
      const ownerProfiles = new Map<string, { name: string; pfp: string | null }>();

      await Promise.all(
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

      for (const nft of nfts) {
        const profile = ownerProfiles.get(nft.ownerAddress.toLowerCase());
        if (profile) {
          if (profile.name) nft.owner = profile.name;
          if (profile.pfp) nft.ownerPfp = profile.pfp;
        }
      }
    } catch { /* enrichment failed */ }

    return json({
      nfts,
      next: nftsData.next ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/collection-nfts] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
