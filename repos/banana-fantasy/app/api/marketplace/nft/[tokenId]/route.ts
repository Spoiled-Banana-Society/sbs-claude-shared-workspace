import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT, COLLECTION_SLUG } from '@/lib/opensea';
import { getRecentCachedListings } from '@/lib/marketplace/listingCache';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { getWalletTrades } from '@/lib/marketplace/activityOwnership';
import { getTeamForToken, getOwnerForToken, teamDataToTraits, mergeTraits, type NftTrait, type TeamData } from '@/lib/marketplace/teamData';
import { resolveTokenImage } from '@/lib/nftCardServer';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/**
 * GET /api/marketplace/nft/[tokenId]
 *
 * Returns full NFT metadata (name, image, traits) for a single BBB4 token.
 */
export async function GET(
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
    if (!tokenId) return jsonError('Missing tokenId', 400);

    // Caller (the detail page) passes the viewing wallet so we can fall back to
    // our own backend if OpenSea isn't ready — the person viewing a freshly
    // drafted team is its owner.
    const ownerHint = new URL(req.url).searchParams.get('owner');

    const res = await fetch(
      `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        next: { revalidate: 60 },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[marketplace/nft] OpenSea error:', res.status, text);
      // OpenSea is mid-reveal (it lags a few minutes behind a fresh draft) — so
      // don't hard-fail. Resolve the owner from OUR backend (works for ANY team,
      // not just the viewer's own — falls back to the viewing wallet hint), then
      // serve the team straight from our backend (the source of truth that
      // updates instantly). OpenSea becomes the default again on the next fetch
      // once it's indexed.
      const owner = ownerHint || (await getOwnerForToken(tokenId));
      if (owner) {
        const team = await getTeamForToken(tokenId, owner);
        if (team) {
          const ogImg = await resolveTokenImage(tokenId, owner);
          return json({
            identifier: tokenId,
            contract: BBB4_CONTRACT,
            token_standard: 'erc721',
            name: team.leagueDisplayName || `#${tokenId}`,
            image_url: ogImg,
            display_image_url: ogImg,
            traits: teamDataToTraits(team),
            owners: [{ address: owner, quantity: 1, quantity_string: '1' }],
            owner,
            ownerName: null,
            ownerPfp: null,
            team,
            listing: null,
            pendingOpenSea: true,
          });
        }
      }
      return jsonError('Failed to fetch NFT', res.status >= 500 ? 502 : res.status);
    }

    const data = await res.json();
    const nft = data.nft ?? data;

    // Also fetch active listing for this token (if any)
    let listing = null;
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
        // Find the listing matching this tokenId
        listing = (listingsData.listings ?? []).find((l: { protocol_data: { parameters: { offer: Array<{ itemType: number; identifierOrCriteria: string }> } } }) => {
          const nftOffer = l.protocol_data.parameters.offer.find(
            (o: { itemType: number }) => o.itemType === 2 || o.itemType === 3,
          );
          return nftOffer?.identifierOrCriteria === tokenId;
        }) ?? null;
      }
    } catch {
      // Silent — listing data is optional
    }

    // Overlay our listing cache to bridge OpenSea's indexing lag: show a
    // just-created listing OpenSea hasn't indexed, hide a just-cancelled one it
    // hasn't dropped. Outside the freshness window OpenSea is authoritative.
    try {
      const cached = await getRecentCachedListings([tokenId]);
      const rec = cached.get(tokenId);
      if (rec) {
        if (rec.status === 'cancelled') {
          listing = null;
        } else if (rec.status === 'active' && !listing) {
          listing = {
            order_hash: rec.orderHash,
            protocol_address: rec.protocolAddress,
            price: { current: { value: String(Math.round(rec.priceUsd * 1e6)), decimals: 6 } },
            protocol_data: { parameters: { offerer: rec.offerer, endTime: rec.endTimeSec ?? undefined } },
          };
        }
      }
    } catch { /* cache is best-effort */ }

    // Owner: read it on-chain (authoritative), since OpenSea's index lags minutes
    // behind a sale and would otherwise report the previous owner — making the
    // buyer's just-bought team show "Make Offer" instead of the list controls.
    // Fall back to OpenSea's reported owner only if the RPC call fails.
    const onchainOwner = await getOnchainOwner(tokenId);
    const owner = onchainOwner ?? nft.owners?.[0]?.address ?? null;

    // Enrich owner with SBS profile + inject team data from our backend
    let ownerName: string | null = null;
    let ownerPfp: string | null = null;
    let traits: NftTrait[] = Array.isArray(nft.traits) ? nft.traits : [];
    let team: TeamData | null = null;

    if (owner) {
      const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
        || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
      try {
        const profileRes = await fetch(`${DRAFTS_API}/owner/${owner.toLowerCase()}`, {
          signal: AbortSignal.timeout(2500),
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          if (profile?.pfp?.displayName) ownerName = profile.pfp.displayName;
          if (profile?.pfp?.imageUrl) ownerPfp = profile.pfp.imageUrl;
        }
      } catch { /* enrichment optional */ }
    }

    team = await getTeamForToken(tokenId, owner);
    if (team) {
      traits = mergeTraits(traits, teamDataToTraits(team));
    }

    // What the current owner paid for this team (so they can see "You paid $X").
    let pricePaid: number | null = null;
    if (owner) {
      try {
        const trades = await getWalletTrades(owner);
        pricePaid = trades.paidByToken.get(String(tokenId)) ?? null;
      } catch { /* best-effort */ }
    }

    // The obsidian SBS card (grey pass / tier team) is the source of truth —
    // it always wins over OpenSea's image. Keyed on realTokenId via our metadata.
    const ogImage = await resolveTokenImage(tokenId, owner);
    return json({
      ...nft,
      traits,
      // Prefer the real league name; only fall back to OpenSea's name when it
      // isn't a generic "#N" / "Draft Pass #N" placeholder.
      name: (nft.name && !/^(draft\s*pass\s*)?#?\s*\d+$/i.test(String(nft.name).trim()))
        ? nft.name
        : (team?.leagueDisplayName || nft.name || null),
      image_url: ogImage || nft.image_url,
      display_image_url: ogImage || nft.display_image_url,
      owner,
      ownerName,
      ownerPfp,
      pricePaid,
      team,
      listing,
    });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/nft] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
