import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { runInBackground } from '@/lib/serverBackground';
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
import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';
import { listFreeOriginTokenIds } from '@/lib/onchain/passOrigin';
import { isDraftingOpen } from '@/lib/draftTypes';
import { recordListed, getAllRecentCachedListings } from '@/lib/marketplace/listingCache';
import { logger } from '@/lib/logger';
import { getTeamsForTokens, teamDataToTraits, mergeTraits } from '@/lib/marketplace/teamData';
import { resolveTokenImage } from '@/lib/nftCardServer';
import { classifyToken } from '@/lib/nftPassClassify';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

// Process-level dedup of refresh-attempts so a hot Buy-tab page doesn't
// hammer OpenSea on every poll. Resets when the Vercel instance recycles,
// which is fine — the worst case is one extra refresh per cold start.
const refreshedTokenIds = new Set<string>();

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

    // SBS-first enrichment: pull team data from our backend for every
    // listing and inject as synthetic traits on the OpenSea NFT before
    // mapping. Our backend is the source of truth — OpenSea is just for
    // ownership/listing orderbook.
    const ownerByTokenId = new Map<string, string>();
    for (let i = 0; i < orders.length; i++) {
      const offerer = orders[i].protocol_data.parameters.offerer;
      if (offerer) ownerByTokenId.set(tokenIds[i], offerer.toLowerCase());
    }
    const teamPairs = [...nftMap.keys()].map(tokenId => ({
      tokenId,
      owner: ownerByTokenId.get(tokenId) ?? null,
    }));
    const teamsByToken = await getTeamsForTokens(teamPairs);

    // Authoritative obsidian image per listed token (drafted → tier team card,
    // undrafted → grey pass) — NOT the old GCS Python card. Owner is known.
    const ogByToken = new Map<string, string>();
    await Promise.all([...nftMap.keys()].map(async (tokenId) => {
      ogByToken.set(tokenId, await resolveTokenImage(tokenId, ownerByTokenId.get(tokenId) ?? null));
    }));

    for (const [tokenId, nft] of nftMap.entries()) {
      const team = teamsByToken.get(tokenId);
      if (team) {
        const synthetic = teamDataToTraits(team);
        const existing = Array.isArray(nft.traits) ? nft.traits : [];
        (nft as { traits: typeof existing }).traits = mergeTraits(existing, synthetic);
        if (team.leagueDisplayName && (!nft.name || /^#?\d+$/.test(nft.name.trim()))) {
          (nft as { name: string }).name = team.leagueDisplayName;
        }
      }
      const og = ogByToken.get(tokenId);
      if (og) {
        (nft as { image_url: string; display_image_url: string }).image_url = og;
        (nft as { image_url: string; display_image_url: string }).display_image_url = og;
      }
    }

    const openSeaListings = orders.map(order => {
      const tokenId = tokenIds[orders.indexOf(order)];
      const nft = nftMap.get(tokenId) ?? null;
      return mapOpenSeaListingToTeam(order, nft);
    });

    // Overlay our listing cache to bridge OpenSea's indexing lag on the public
    // Buy grid: HIDE a just-cancelled team OpenSea hasn't dropped yet, and ADD a
    // just-listed one it hasn't indexed yet. Outside the freshness window
    // OpenSea is authoritative. Best-effort — failures fall back to OpenSea.
    let allListings = openSeaListings;
    try {
      const recentCache = await getAllRecentCachedListings();
      if (recentCache.length > 0) {
        const cancelledTokens = new Set(recentCache.filter(r => r.status === 'cancelled').map(r => String(r.tokenId)));
        const presentTokens = new Set(openSeaListings.map(l => String(l.tokenId)));
        const cacheOnlyActive = recentCache.filter(
          r => r.status === 'active' && !presentTokens.has(String(r.tokenId)) && !cancelledTokens.has(String(r.tokenId)),
        );

        // Build cards for cache-active listings OpenSea hasn't indexed yet.
        const cacheCards: typeof openSeaListings = [];
        if (cacheOnlyActive.length > 0) {
          const extraNftMap = new Map<string, OpenSeaNft>();
          await Promise.all(cacheOnlyActive.map(async (rec) => {
            try {
              const r = await fetch(
                `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${rec.tokenId}`,
                { headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY }, next: { revalidate: 300 } },
              );
              if (r.ok) { const d = await r.json(); if (d.nft) extraNftMap.set(String(rec.tokenId), d.nft); }
            } catch { /* skip metadata */ }
          }));
          const extraTeams = await getTeamsForTokens(cacheOnlyActive.map(rec => ({ tokenId: String(rec.tokenId), owner: rec.offerer })));
          await Promise.all([...extraNftMap.entries()].map(async ([tid, nft]) => {
            const team = extraTeams.get(tid);
            if (team) {
              const existing = Array.isArray(nft.traits) ? nft.traits : [];
              (nft as { traits: typeof existing }).traits = mergeTraits(existing, teamDataToTraits(team));
              if (team.leagueDisplayName && (!nft.name || /^#?\d+$/.test(nft.name.trim()))) (nft as { name: string }).name = team.leagueDisplayName;
            }
            const og = await resolveTokenImage(tid, cacheOnlyActive.find(r => String(r.tokenId) === tid)?.offerer ?? null);
            (nft as { image_url: string; display_image_url: string }).image_url = og;
            (nft as { image_url: string; display_image_url: string }).display_image_url = og;
          }));
          for (const rec of cacheOnlyActive) {
            const nft = extraNftMap.get(String(rec.tokenId)) ?? null;
            const syntheticOrder = {
              order_hash: rec.orderHash,
              protocol_address: rec.protocolAddress,
              price: { current: { value: String(Math.round(rec.priceUsd * 1e6)), decimals: 6, currency: 'USDC' } },
              protocol_data: { parameters: { offerer: rec.offerer, offer: [{ itemType: 2, identifierOrCriteria: String(rec.tokenId) }], endTime: rec.endTimeSec ?? undefined } },
            } as unknown as OpenSeaListing;
            cacheCards.push(mapOpenSeaListingToTeam(syntheticOrder, nft));
          }
        }

        allListings = [...openSeaListings.filter(l => !cancelledTokens.has(String(l.tokenId))), ...cacheCards];
      }
    } catch { /* cache overlay is best-effort */ }

    // Fire-and-forget OpenSea metadata refresh for tokens that still have
    // sparse traits after our backend enrichment. Helps OpenSea catch up
    // on its end too. Deduped per process via the module-level Set.
    for (const tokenId of nftMap.keys()) {
      if (teamsByToken.has(tokenId)) continue;
      if (refreshedTokenIds.has(tokenId)) continue;
      refreshedTokenIds.add(tokenId);
      runInBackground('opensea.metadata-refresh', fetch(
        `${OPENSEA_API_BASE}/api/v2/chain/${OPENSEA_CHAIN}/contract/${BBB4_CONTRACT}/nfts/${tokenId}/refresh`,
        { method: 'POST', headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY } },
      ));
    }

    // Deduplicate — keep only the first (most recent) listing per team
    const seen = new Set<string>();
    const listings = allListings.filter(listing => {
      if (seen.has(listing.name)) return false;
      seen.add(listing.name);
      return true;
    });

    // Enrich with SBS owner profiles (name + pfp) — best-effort with timeout
    const DRAFTS_API = getServerDraftsApiUrl();
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

    // Overlay wheel-won JP/HOF level for any listed pass still in a filling
    // round, so the Buy grid renders it with its tier (gold HOF / red Jackpot)
    // + badge like the Sell side. Best-effort.
    try {
      const { getFillingWheelPassLevels } = await import('@/lib/db');
      const levels = await getFillingWheelPassLevels(listings.map(l => String(l.tokenId)));
      for (const listing of listings) {
        const lvl = levels[String(listing.tokenId)];
        if (lvl) (listing as { fillingWheelLevel?: 'jackpot' | 'hof' }).fillingWheelLevel = lvl;
      }
    } catch { /* best-effort — Buy card falls back to the generic pass look */ }

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

/**
 * POST /api/marketplace/listings
 *
 * Forwards a signed Seaport order to OpenSea's listings endpoint.
 * Body: { ...order, protocol_address }
 * Keeps OPENSEA_API_KEY server-side only.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) {
      return jsonError('OpenSea API key not configured', 503);
    }

    const body = await req.json();
    if (!body?.parameters || !body?.signature || !body?.protocol_address) {
      return jsonError('Missing signed order fields', 400);
    }

    // Server-side enforcement: a FREE draft pass can't be sold until it's been
    // drafted into an actual team. The UI blocks it, but the API is the real
    // gate (someone could POST a signed order directly). Two checks:
    //   (a) authoritative — the Go API says this token is still an undrafted
    //       pass AND its passType is free (classifyToken). Once drafted it
    //       leaves the `available` list, so a revealed team lists fine.
    //   (b) backstop — pass_origin free-mint records during the season-open
    //       window (covers Go-down / classifier-miss). Fail-OPEN on errors so a
    //       flaky check never blocks a legitimate paid-pass listing.
    {
      const offerItems = (body.parameters.offer ?? []) as Array<{ itemType: number; identifierOrCriteria?: string }>;
      const nftItem = offerItems.find((o) => o.itemType === 2 || o.itemType === 3);
      const tokenId = nftItem?.identifierOrCriteria;
      const offerer = String(body.parameters.offerer ?? '').toLowerCase();

      // EXCEPTION to the free-pass block: a wheel-won JP/HOF pass that's still in a
      // FILLING queue round is intentionally sellable now (the whole point of the
      // feature) even though it's a free pass. Mirrors the client (SellTab surfaces
      // it via fillingWheelLevel). Without this the server 403s the very listing the
      // UI offers. Best-effort: on error fall through to the normal guard.
      let isFillingWheelPass = false;
      if (tokenId) {
        try {
          const { getFillingWheelPassLevels } = await import('@/lib/db');
          const levels = await getFillingWheelPassLevels([String(tokenId)]);
          isFillingWheelPass = !!levels[String(tokenId)];
        } catch { /* fall through to the normal free-pass guard */ }
      }

      if (!isFillingWheelPass && tokenId && offerer) {
        try {
          const cls = await classifyToken(String(tokenId), offerer);
          if (cls.isPass && /free/i.test(cls.passType || '')) {
            logger.info('marketplace.free_pass_list_blocked', { tokenId: String(tokenId), offerer, reason: 'undrafted_free_pass' });
            return jsonError('A free draft pass can only be sold after you draft it into a team.', 403);
          }
        } catch { /* classifier unavailable — fall through to the backstop */ }
      }
      if (!isFillingWheelPass && isDraftingOpen() && tokenId && offerer) {
        try {
          const freeIds = new Set((await listFreeOriginTokenIds(offerer)).map(String));
          if (freeIds.has(String(tokenId))) {
            logger.info('marketplace.free_pass_list_blocked', { tokenId: String(tokenId), offerer, reason: 'free_origin_season_open' });
            return jsonError('Free draft passes can only be listed once the season starts.', 403);
          }
        } catch (guardErr) {
          console.error('[marketplace/listings] free-pass guard check failed (allowing listing):', guardErr);
        }
      }
    }

    const postRes = await fetch(
      `${OPENSEA_API_BASE}/api/v2/orders/base/seaport/listings`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
        body: JSON.stringify(body),
      },
    );

    const text = await postRes.text();
    if (!postRes.ok) {
      console.error('[marketplace/listings] OpenSea POST failed:', postRes.status, text);
      let detail = '';
      try {
        const errJson = JSON.parse(text);
        detail = errJson.errors?.[0] || errJson.detail || errJson.message || text;
      } catch { detail = text; }
      return jsonError(`OpenSea error: ${detail}`, postRes.status >= 500 ? 502 : postRes.status);
    }

    const result = JSON.parse(text);
    // OpenSea's create-listing response shape has varied; try the known paths so
    // we reliably capture the order hash (the client's optimistic update AND the
    // listing cache both depend on it).
    const orderHash =
      result?.order?.order_hash
      || result?.order_hash
      || result?.order?.orderHash
      || result?.orders?.[0]?.order_hash
      || '';
    if (!orderHash) {
      logger.warn('marketplace.listings.no_order_hash', {
        topKeys: Object.keys(result ?? {}),
        orderKeys: result?.order ? Object.keys(result.order) : null,
      });
    }

    // Record in our own listing cache so the UI reflects it instantly (don't
    // wait on OpenSea's indexing lag). Best-effort.
    try {
      const params = body.parameters as {
        offerer?: string;
        endTime?: string;
        offer: Array<{ itemType: number; identifierOrCriteria?: string }>;
        consideration: Array<{ itemType: number; startAmount?: string }>;
      };
      const nftItem = params.offer?.find((o) => o.itemType === 2 || o.itemType === 3);
      const tokenId = nftItem?.identifierOrCriteria;
      // Sum the USDC (ERC-20) consideration legs = total sale price.
      const totalWei = (params.consideration ?? []).reduce(
        (s, c) => s + (c.itemType === 1 ? BigInt(c.startAmount || '0') : 0n),
        0n,
      );
      if (tokenId) {
        await recordListed({
          tokenId,
          orderHash,
          priceUsd: Number(totalWei) / 1e6,
          endTimeSec: params.endTime ?? null,
          offerer: String(params.offerer ?? ''),
          protocolAddress: String(body.protocol_address ?? ''),
        });
      }
    } catch { /* cache is best-effort */ }

    return json({ orderHash });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/listings] POST failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
