import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { OPENSEA_API_BASE, OPENSEA_CHAIN, BBB4_CONTRACT } from '@/lib/opensea';
import { getRecentCachedListings } from '@/lib/marketplace/listingCache';
import { getCollectionListings } from '@/lib/marketplace/collectionListings';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { getWalletTrades } from '@/lib/marketplace/activityOwnership';
import { getTeamForToken, getOwnerForToken, teamDataToTraits, mergeTraits, type NftTrait, type TeamData } from '@/lib/marketplace/teamData';
import { resolveTokenImage } from '@/lib/nftCardServer';
import { getUserDisplayBatch } from '@/lib/db';
import type { Ripeness } from '@/types';

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

    // Active listing for this token (from the shared 15s listings cache).
    let listing: unknown = (await getCollectionListings()).get(tokenId) ?? null;

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

    // Enrich owner with SBS profile + inject team data from our backend.
    // These four all depend only on `owner`, not on each other, so run them
    // together instead of in series (was the bulk of the detail-page latency).
    let ownerName: string | null = null;
    let ownerPfp: string | null = null;
    let ownerBadge: string | null = null;
    let ownerRipeness: Ripeness | null = null;
    let traits: NftTrait[] = Array.isArray(nft.traits) ? nft.traits : [];
    let team: TeamData | null = null;
    let pricePaid: number | null = null;

    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
    const ownerLc = owner ? owner.toLowerCase() : null;
    const [profile, displays, teamResult, trades, ogImage] = await Promise.all([
      ownerLc
        ? fetch(`${DRAFTS_API}/owner/${ownerLc}`, { signal: AbortSignal.timeout(2500) })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
      ownerLc ? getUserDisplayBatch([ownerLc]).catch(() => ({})) : Promise.resolve({}),
      getTeamForToken(tokenId, owner).catch(() => null),
      owner ? getWalletTrades(owner).catch(() => null) : Promise.resolve(null),
      resolveTokenImage(tokenId, owner).catch(() => ''),
    ]);

    // Owner display identity: custom username → legacy Go name → permanent
    // "Banana{N}" handle. Pfp: custom → Go pfp → null (UI shows the banana).
    // Badge: ONLY their equipped badge (an NFL team or an EARNED ripeness banana
    // from ≥1 paid draft). There is NO default badge — a brand-new wallet shows
    // just the banana avatar + name, no badge. ripeness is returned so the UI can
    // render the earned banana badge for drafters who haven't equipped another.
    const v2 = ownerLc ? (displays as Record<string, { username: string | null; profilePicture: string | null; equippedBadge: string | null; bananaNumber: number | null; ripeness: Ripeness | null }>)[ownerLc] : null;
    const goName = typeof profile?.pfp?.displayName === 'string' && profile.pfp.displayName.toLowerCase() !== ownerLc ? profile.pfp.displayName : null;
    const bananaName = v2?.bananaNumber != null ? `Banana${v2.bananaNumber}` : null;
    ownerName = v2?.username || goName || bananaName;
    ownerPfp = v2?.profilePicture || profile?.pfp?.imageUrl || null;
    ownerBadge = v2?.equippedBadge ?? null;
    ownerRipeness = v2?.ripeness ?? null;
    team = teamResult;
    if (team) traits = mergeTraits(traits, teamDataToTraits(team));
    if (trades) pricePaid = trades.paidByToken.get(String(tokenId)) ?? null;
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
      ownerBadge,
      ownerRipeness,
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
