import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  OPENSEA_CHAIN,
  BBB4_CONTRACT,
  COLLECTION_SLUG,
  mapOpenSeaNftToTeam,
  type OpenSeaNft,
  type OpenSeaListing,
} from '@/lib/opensea';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * GET /api/marketplace/nfts?owner=0x...
 *
 * Returns BBB4 NFTs owned by a specific wallet address,
 * with active listing data (orderHash, price) merged in.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const owner = getSearchParam(req, 'owner');
    if (!owner) return jsonError('Missing owner address', 400);

    const nftParams = new URLSearchParams({
      collection: COLLECTION_SLUG,
      limit: '200',
    });

    // Fetch owned NFTs and active collection listings in parallel
    const [nftRes, listingsRes] = await Promise.all([
      fetch(
        `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/account/${owner}/nfts?${nftParams}`,
        {
          headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
          cache: 'no-store',
        },
      ),
      fetch(
        `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
        {
          headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
          cache: 'no-store',
        },
      ),
    ]);

    if (!nftRes.ok) {
      const text = await nftRes.text();
      console.error('[marketplace/nfts] OpenSea error:', nftRes.status, text);
      return jsonError('Failed to fetch owned NFTs', nftRes.status >= 500 ? 502 : nftRes.status);
    }

    const data = await nftRes.json();
    const rawNfts: OpenSeaNft[] = data.nfts ?? [];

    // Build a map of tokenId → listing info from active listings by this owner
    const listingMap = new Map<string, { orderHash: string; price: number; protocolAddress: string }>();
    if (listingsRes.ok) {
      const listingsData = await listingsRes.json();
      const allListings: OpenSeaListing[] = listingsData.listings ?? [];
      for (const listing of allListings) {
        const offerer = listing.protocol_data.parameters.offerer?.toLowerCase();
        if (offerer !== owner.toLowerCase()) continue;
        const nftOffer = listing.protocol_data.parameters.offer.find(
          (o: { itemType: number }) => o.itemType === 2 || o.itemType === 3,
        );
        const tokenId = nftOffer?.identifierOrCriteria ?? '0';
        const value = listing.price?.current?.value;
        const decimals = listing.price?.current?.decimals ?? 18;
        const price = value ? Number(value) / Math.pow(10, decimals) : 0;
        listingMap.set(tokenId, {
          orderHash: listing.order_hash,
          price,
          protocolAddress: listing.protocol_address,
        });
      }
    }

    // Filter to only BBB4 contract NFTs (safety check)
    const bbb4Nfts = rawNfts.filter(
      nft => nft.contract?.toLowerCase() === BBB4_CONTRACT.toLowerCase(),
    );

    const nfts = bbb4Nfts.map(nft => {
      const { ownerAddress: _ownerAddress, ...rest } = mapOpenSeaNftToTeam(nft, owner);
      // Merge listing data if this token is actively listed
      const listing = listingMap.get(nft.identifier);
      if (listing) {
        return { ...rest, orderHash: listing.orderHash, price: listing.price, protocolAddress: listing.protocolAddress };
      }
      return rest;
    });

    return json({ nfts });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/nfts] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
