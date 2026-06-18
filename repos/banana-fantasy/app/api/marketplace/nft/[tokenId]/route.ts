import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { bananaDefaultName } from '@/utils/helpers';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { BBB4_CONTRACT } from '@/lib/opensea';
import { getRecentCachedListings } from '@/lib/marketplace/listingCache';
import { getCollectionListings } from '@/lib/marketplace/collectionListings';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';
import { getWalletTrades } from '@/lib/marketplace/activityOwnership';
import { getTeamForToken, getOwnerForToken, teamDataToTraits, type NftTrait } from '@/lib/marketplace/teamData';
import { resolveTokenImage } from '@/lib/nftCardServer';
import { getUserDisplayBatch } from '@/lib/db';
import type { Ripeness } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/nft/[tokenId]
 *
 * Full data for a single BBB4 token — DATA from our backend, OWNERSHIP from the
 * chain (Alchemy/RPC). OpenSea is NOT a data source here; it's only the order
 * layer (the active-listing overlay for price). This makes the detail page
 * instant + correct in real time, instead of waiting on OpenSea's metadata lag.
 */
export async function GET(
  req: Request,
  { params }: { params: { tokenId: string } },
) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { tokenId } = params;
    if (!tokenId) return jsonError('Missing tokenId', 400);

    // Viewing wallet — a fallback owner hint for a freshly drafted team whose
    // on-chain owner read hasn't propagated yet (the viewer is its owner).
    const ownerHint = new URL(req.url).searchParams.get('owner');

    // OWNERSHIP from the chain; never OpenSea (which lags minutes behind a sale).
    const onchainOwner = await getOnchainOwner(tokenId);
    const owner = onchainOwner ?? ownerHint ?? (await getOwnerForToken(tokenId)) ?? null;

    // Active listing (the order layer): shared 15s OpenSea listings cache,
    // reconciled with our own cache so a just-created/cancelled listing is right.
    let listing: unknown = (await getCollectionListings()).get(tokenId) ?? null;
    try {
      const rec = (await getRecentCachedListings([tokenId])).get(tokenId);
      if (rec) {
        if (rec.status === 'cancelled') listing = null;
        else if (rec.status === 'active' && !listing) {
          listing = {
            order_hash: rec.orderHash,
            protocol_address: rec.protocolAddress,
            price: { current: { value: String(Math.round(rec.priceUsd * 1e6)), decimals: 6 } },
            protocol_data: { parameters: { offerer: rec.offerer, endTime: rec.endTimeSec ?? undefined } },
          };
        }
      }
    } catch { /* listing cache is best-effort */ }

    // Owner identity + team data + image, all from our backend, in parallel.
    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
    const ownerLc = owner ? owner.toLowerCase() : null;
    const [profile, displays, teamResult, trades, ogImage] = await Promise.all([
      ownerLc
        ? fetch(`${DRAFTS_API}/owner/${ownerLc}`, { signal: AbortSignal.timeout(2500) })
            .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null),
      ownerLc ? getUserDisplayBatch([ownerLc]).catch(() => ({})) : Promise.resolve({}),
      getTeamForToken(tokenId, owner).catch(() => null),
      owner ? getWalletTrades(owner).catch(() => null) : Promise.resolve(null),
      resolveTokenImage(tokenId, owner).catch(() => ''),
    ]);

    // Owner display identity: custom username → legacy Go name → permanent
    // "Banana{N}" handle. Badge: only an EQUIPPED badge (no default).
    const v2 = ownerLc ? (displays as Record<string, { username: string | null; profilePicture: string | null; equippedBadge: string | null; bananaNumber: number | null; ripeness: Ripeness | null }>)[ownerLc] : null;
    const goName = typeof profile?.pfp?.displayName === 'string' && profile.pfp.displayName.toLowerCase() !== ownerLc ? profile.pfp.displayName : null;
    // Wallet-derived default — same derivation as the header (bananaDefaultName).
    const bananaName = ownerLc ? bananaDefaultName(ownerLc) : null;
    const ownerName = v2?.username || goName || bananaName;
    const ownerPfp = v2?.profilePicture || profile?.pfp?.imageUrl || null;
    const ownerBadge = v2?.equippedBadge ?? null;
    const ownerRipeness = v2?.ripeness ?? null;
    const team = teamResult;
    const traits: NftTrait[] = team ? teamDataToTraits(team) : [];
    const pricePaid = trades ? (trades.paidByToken.get(String(tokenId)) ?? null) : null;

    return json({
      identifier: tokenId,
      contract: BBB4_CONTRACT,
      token_standard: 'erc721',
      traits,
      name: team?.leagueDisplayName || `#${tokenId}`,
      image_url: ogImage,
      display_image_url: ogImage,
      owners: owner ? [{ address: owner, quantity: 1, quantity_string: '1' }] : [],
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
