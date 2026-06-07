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
import { getTeamsForTokens, getTeamForToken, teamDataToTraits, mergeTraits } from '@/lib/marketplace/teamData';
import { ogImageFromTeam } from '@/lib/nftCardServer';
import { getRecentCachedListings } from '@/lib/marketplace/listingCache';
import { getWalletTrades } from '@/lib/marketplace/activityOwnership';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';

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

    // Kick off the active-listings fetch in parallel (used to merge orderHash/
    // price onto owned NFTs so listed teams show "Delist").
    const listingsPromise = fetch(
      `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=100`,
      {
        headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
        cache: 'no-store',
      },
    );

    // Paginate owned NFTs via the `next` cursor — a heavy holder (e.g. someone
    // with many unused draft passes) owns more than one page, and the old
    // single 200-item fetch silently truncated the Sell list. Capped at
    // MAX_PAGES to bound work.
    const rawNfts: OpenSeaNft[] = [];
    let nftFetchFailed: { status: number; text: string } | null = null;
    let cursor = '';
    const MAX_PAGES = 10;
    for (let page = 0; page < MAX_PAGES; page++) {
      const nftParams = new URLSearchParams({ collection: COLLECTION_SLUG, limit: '200' });
      if (cursor) nftParams.set('next', cursor);
      const pageRes = await fetch(
        `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/account/${owner}/nfts?${nftParams}`,
        {
          headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
          cache: 'no-store',
        },
      );
      if (!pageRes.ok) {
        nftFetchFailed = { status: pageRes.status, text: await pageRes.text() };
        break;
      }
      const pageData = await pageRes.json();
      rawNfts.push(...((pageData.nfts ?? []) as OpenSeaNft[]));
      if (!pageData.next) break;
      cursor = pageData.next;
    }

    const listingsRes = await listingsPromise;

    // Only hard-fail if we got nothing at all; a mid-pagination failure keeps
    // the pages we did fetch rather than showing an empty Sell list.
    if (nftFetchFailed && rawNfts.length === 0) {
      console.error('[marketplace/nfts] OpenSea error:', nftFetchFailed.status, nftFetchFailed.text);
      return jsonError('Failed to fetch owned NFTs', nftFetchFailed.status >= 500 ? 502 : nftFetchFailed.status);
    }

    // Build a map of tokenId → listing info from active listings by this owner
    const listingMap = new Map<string, { orderHash: string; price: number; protocolAddress: string; endTime: string | null }>();
    if (listingsRes.ok) {
      const listingsData = await listingsRes.json();
      const allListings: OpenSeaListing[] = listingsData.listings ?? [];
      for (const listing of allListings) {
        const params = listing.protocol_data.parameters as { offerer?: string; endTime?: string; offer: Array<{ itemType: number; identifierOrCriteria?: string }> };
        const offerer = params.offerer?.toLowerCase();
        if (offerer !== owner.toLowerCase()) continue;
        const nftOffer = params.offer.find((o) => o.itemType === 2 || o.itemType === 3);
        const tokenId = nftOffer?.identifierOrCriteria ?? '0';
        const value = listing.price?.current?.value;
        const decimals = listing.price?.current?.decimals ?? 18;
        const price = value ? Number(value) / Math.pow(10, decimals) : 0;
        listingMap.set(tokenId, {
          orderHash: listing.order_hash,
          price,
          protocolAddress: listing.protocol_address,
          endTime: params.endTime ?? null,
        });
      }
    }

    // Filter to only BBB4 contract NFTs (safety check)
    const bbb4Nfts = rawNfts.filter(
      nft => nft.contract?.toLowerCase() === BBB4_CONTRACT.toLowerCase(),
    );

    // Overlay our own listing cache to bridge OpenSea's indexing lag: surface a
    // freshly-created listing OpenSea hasn't indexed yet, and hide one it hasn't
    // dropped yet. Outside the freshness window OpenSea is authoritative.
    const cached = await getRecentCachedListings(bbb4Nfts.map(n => n.identifier));
    for (const [tokenId, rec] of cached) {
      if (rec.status === 'active' && !listingMap.has(tokenId)) {
        listingMap.set(tokenId, { orderHash: rec.orderHash, price: rec.priceUsd, protocolAddress: rec.protocolAddress, endTime: rec.endTimeSec });
      } else if (rec.status === 'cancelled') {
        listingMap.delete(tokenId);
      }
    }

    // SBS-first enrichment: pull team data from our backend for each owned
    // NFT and inject as synthetic traits + image override before mapping.
    const teamsByToken = await getTeamsForTokens(
      bbb4Nfts.map(nft => ({ tokenId: nft.identifier, owner })),
    );
    for (const nft of bbb4Nfts) {
      const team = teamsByToken.get(nft.identifier);
      if (team) {
        const synthetic = teamDataToTraits(team);
        const existing = Array.isArray(nft.traits) ? nft.traits : [];
        (nft as { traits: typeof existing }).traits = mergeTraits(existing, synthetic);
        // Override OpenSea's generic name with the real league name.
        if (team.leagueDisplayName && (!nft.name || /^(draft\s*pass\s*)?#?\s*\d+$/i.test(nft.name.trim()))) {
          (nft as { name: string }).name = team.leagueDisplayName;
        }
      }
      // Always the obsidian card: drafted → tier team, un-drafted → grey pass.
      const og = ogImageFromTeam(team, nft.identifier);
      (nft as { image_url: string; display_image_url: string }).image_url = og;
      (nft as { image_url: string; display_image_url: string }).display_image_url = og;
    }

    // Recent trades for this wallet, so we can reflect a just-bought/just-sold
    // team before OpenSea's account index catches up, and surface what was paid.
    const trades = await getWalletTrades(owner);

    const nfts = bbb4Nfts.map(nft => {
      const { ownerAddress: _ownerAddress, ...rest } = mapOpenSeaNftToTeam(nft, owner);
      const hasBackendRecord = teamsByToken.has(nft.identifier);
      const leagueId = teamsByToken.get(nft.identifier)?.leagueId ?? null;
      const pricePaid = trades.paidByToken.get(nft.identifier) ?? null;
      // Merge listing data if this token is actively listed
      const listing = listingMap.get(nft.identifier);
      if (listing) {
        return { ...rest, hasBackendRecord, leagueId, pricePaid, orderHash: listing.orderHash, price: listing.price, protocolAddress: listing.protocolAddress, listingEndTime: listing.endTime };
      }
      return { ...rest, hasBackendRecord, leagueId, pricePaid };
    });

    // Drop teams the wallet just sold that OpenSea still lists under it (confirm
    // on-chain the wallet truly no longer owns them before hiding).
    let finalNfts = nfts;
    if (trades.recentSells.size > 0) {
      const soldIds = [...trades.recentSells];
      const confirmedSold = new Set<string>();
      await Promise.all(soldIds.map(async (tid) => {
        const onchain = await getOnchainOwner(tid);
        if (onchain && onchain !== owner.toLowerCase()) confirmedSold.add(tid);
      }));
      finalNfts = finalNfts.filter(n => !confirmedSold.has(n.tokenId));
    }

    // Add teams the wallet just bought that OpenSea hasn't indexed yet (confirm
    // on-chain the wallet really owns them now before adding).
    const presentIds = new Set(finalNfts.map(n => n.tokenId));
    const buyCandidates = trades.recentBuys.filter(b => !presentIds.has(b.tokenId));
    if (buyCandidates.length > 0) {
      const added = await Promise.all(buyCandidates.map(async (b) => {
        const onchain = await getOnchainOwner(b.tokenId);
        if (!onchain || onchain !== owner.toLowerCase()) return null;
        const team = await getTeamForToken(b.tokenId, owner);
        const og = ogImageFromTeam(team, b.tokenId);
        const synthetic = team
          ? { identifier: b.tokenId, contract: BBB4_CONTRACT, name: team.leagueDisplayName || null, image_url: og, display_image_url: og, traits: teamDataToTraits(team) }
          : { identifier: b.tokenId, contract: BBB4_CONTRACT, name: b.teamName, image_url: og, display_image_url: og, traits: [] };
        const { ownerAddress: _o, ...rest } = mapOpenSeaNftToTeam(synthetic as OpenSeaNft, owner);
        const listing = listingMap.get(b.tokenId);
        return {
          ...rest,
          hasBackendRecord: !!team,
          leagueId: team?.leagueId ?? null,
          pricePaid: trades.paidByToken.get(b.tokenId) ?? null,
          ...(listing ? { orderHash: listing.orderHash, price: listing.price, protocolAddress: listing.protocolAddress, listingEndTime: listing.endTime } : {}),
        };
      }));
      finalNfts = [...added.filter((n): n is NonNullable<typeof n> => n !== null), ...finalNfts];
    }

    return json({ nfts: finalNfts });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/nfts] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
