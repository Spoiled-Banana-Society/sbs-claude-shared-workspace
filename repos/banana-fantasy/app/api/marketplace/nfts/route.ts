import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  BBB4_CONTRACT,
  COLLECTION_SLUG,
  mapOpenSeaNftToTeam,
  type OpenSeaNft,
  type OpenSeaListing,
} from '@/lib/opensea';
import { getTeamsForTokens, getTeamForToken, teamDataToTraits, mergeTraits, getOwnerOnchainTokenIds } from '@/lib/marketplace/teamData';
import { ogImageFromTeam, resolveTokenImage } from '@/lib/nftCardServer';
import { buildDraftPassUrl } from '@/lib/nftCard';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getRecentCachedListings } from '@/lib/marketplace/listingCache';
import { getWalletTrades } from '@/lib/marketplace/activityOwnership';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';

export const dynamic = 'force-dynamic';

// A token only counts as a drafted TEAM once its roster is complete. Joining a
// lobby assigns a _leagueId immediately (empty roster), so without this gate an
// undrafted pass in a filling lobby flips hasBackendRecord true and wrongly
// shows on the Teams page + Sell tab before the draft finishes. Matches the
// Teams page bar (leagues filtered at roster.length >= 15). Wheel-won JP/HOF
// passes mid-fill are the intended exception, surfaced via fillingWheelLevel.
// (Boris 2026-06-15)
const DRAFTED_ROSTER_MIN = 15;

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

// Short-lived cache of a wallet's raw owned-NFT list. Paginating a whale's
// holdings (admin owns 600+ passes → 3-4 serial OpenSea pages) is what made the
// Sell page take ~8s. Ownership changes only on buy/sell, and the recent-trades
// overlay below ADDS just-bought / REMOVES just-sold teams on every request, so
// a stale-by-≤45s raw list is reconciled to the truth — reloads are instant.
const ownedCache = new Map<string, { ts: number; nfts: OpenSeaNft[] }>();
const OWNED_TTL_MS = 45_000;

// Full enriched-response cache — a reload / tab-switch within the window returns
// the prior result instantly (no Alchemy/backend round-trips at all). Short TTL
// so a buy/sell/draft still shows up within seconds.
const respCache = new Map<string, { ts: number; nfts: unknown[] }>();
// 4s (was 12s): the draft-close stream ping refetches My Teams ~300ms after
// the team image lands in marketplace_index — a longer TTL could serve the
// stale grey-pass response right past that nudge.
const RESP_TTL_MS = 4_000;

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
    const owner = getSearchParam(req, 'owner');
    if (!owner) return jsonError('Missing owner address', 400);

    // Instant path: serve the cached enriched response if it's still fresh.
    const respKey = owner.toLowerCase();
    const cachedResp = respCache.get(respKey);
    if (cachedResp && Date.now() - cachedResp.ts < RESP_TTL_MS) {
      return json({ nfts: cachedResp.nfts });
    }

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
    // MAX_PAGES to bound work. Served from a 45s per-owner cache (the slow part)
    // so reloads are instant; the recent-trades overlay below keeps it correct.
    const rawNfts: OpenSeaNft[] = [];
    let nftFetchFailed: { status: number; text: string } | null = null;
    const cacheKey = owner.toLowerCase();
    const cachedOwned = ownedCache.get(cacheKey);
    if (cachedOwned && Date.now() - cachedOwned.ts < OWNED_TTL_MS) {
      rawNfts.push(...cachedOwned.nfts);
    } else {
      // Ownership comes from Alchemy (the chain) — ONE fast paginated call for the
      // whole wallet, vs OpenSea's 3-4 serial account pages that made the Sell page
      // take ~8s and silently returned empty when rate-limited. We need only the
      // token ids here; image/traits/name are rebuilt from our backend below.
      try {
        const alchemyBase = (process.env.NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL || '').replace('/v2/', '/nft/v3/').replace(/\/$/, '');
        if (!alchemyBase) throw new Error('Alchemy RPC url not configured');
        let pageKey: string | undefined;
        do {
          const u = new URL(alchemyBase + '/getNFTsForOwner');
          u.searchParams.set('owner', owner);
          u.searchParams.append('contractAddresses[]', BBB4_CONTRACT);
          u.searchParams.set('withMetadata', 'false');
          if (pageKey) u.searchParams.set('pageKey', pageKey);
          const r = await fetch(u, { cache: 'no-store' });
          if (!r.ok) { nftFetchFailed = { status: r.status, text: await r.text() }; break; }
          const d = await r.json();
          for (const n of (d.ownedNfts ?? [])) {
            const tid = String(BigInt(n.tokenId));
            rawNfts.push({ identifier: tid, contract: BBB4_CONTRACT, traits: [], name: null, image_url: '', display_image_url: '' } as unknown as OpenSeaNft);
          }
          pageKey = d.pageKey;
        } while (pageKey);
      } catch (e) {
        nftFetchFailed = { status: 502, text: String(e) };
      }
      // Cache only a fully-successful fetch (don't pin a partial/failed list).
      if (!nftFetchFailed) ownedCache.set(cacheKey, { ts: Date.now(), nfts: [...rawNfts] });
    }

    // Authoritative backstop: union our own draftTokens (the SAME source the
    // Teams page trusts) so a team that was just generated when a draft
    // finished shows on Sell IMMEDIATELY, instead of waiting for Alchemy's
    // owner index to catch up (the "my teams don't all show / aren't real-time"
    // bug — nothing was sold; Alchemy was just behind on fresh mints). Runs
    // every request (outside the Alchemy cache) so freshness isn't pinned.
    // Best-effort + deduped, so it can only ADD missing teams, never remove.
    try {
      const goTokenIds = await getOwnerOnchainTokenIds(owner);
      const haveIds = new Set(rawNfts.map(n => n.identifier));
      // Go's draftToken list keeps every team under its ORIGINAL drafter FOREVER,
      // so a token it returns that's NOT in the Alchemy (authoritative on-chain)
      // holdings is EITHER a fresh mint Alchemy hasn't indexed yet (add it) OR a
      // team the drafter has since SOLD or directly TRANSFERRED away (must NOT add
      // — this unconditional union is what made sold/transferred teams reappear).
      // Only ownerOf can tell them apart, so ownerOf-confirm before adding. The
      // cap only bounds the fresh-mint ADD backstop; sold/transferred REMOVAL is
      // handled by the Alchemy base + recentSells, so it can never re-show one.
      const missing = goTokenIds.filter(tid => !haveIds.has(tid)).slice(0, 50);
      if (missing.length > 0) {
        const confirmed = await Promise.all(missing.map(async (tid) => {
          const oc = await getOnchainOwner(tid);
          return oc && oc === owner.toLowerCase() ? tid : null;
        }));
        for (const tid of confirmed) {
          if (tid) rawNfts.push({ identifier: tid, contract: BBB4_CONTRACT, traits: [], name: null, image_url: '', display_image_url: '' } as unknown as OpenSeaNft);
        }
      }
    } catch { /* backstop is best-effort — Alchemy list still stands */ }

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
    // Image per token from ONE batched index read — the chain-anchored
    // marketplace_index already stores each team's card image; passes render the
    // grey pass art. This replaces a per-token resolveTokenImage call (600+
    // Firestore round-trips for a whale wallet), which was the remaining Sell
    // latency. getAll is chunked to stay under Firestore's batch limit.
    const ogByToken = new Map<string, string>();
    const leagueByToken = new Map<string, number>(); // index leagueNumber → recency sort
    if (isFirestoreConfigured()) {
      const db = getAdminFirestore();
      const ids = bbb4Nfts.map((n) => n.identifier);
      for (let i = 0; i < ids.length; i += 300) {
        const refs = ids.slice(i, i + 300).map((id) => db.collection('marketplace_index').doc(id));
        const docs = await db.getAll(...refs);
        docs.forEach((d, k) => {
          const id = ids[i + k];
          const x = d.exists ? (d.data() as Record<string, unknown>) : null;
          ogByToken.set(id, x?.status === 'team' && x?.image ? String(x.image) : buildDraftPassUrl(id));
          if (x?.status === 'team' && typeof x?.leagueNumber === 'number') {
            leagueByToken.set(id, x.leagueNumber as number);
          }
        });
      }
    }
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
      const og = ogByToken.get(nft.identifier) || ogImageFromTeam(team, nft.identifier);
      (nft as { image_url: string; display_image_url: string }).image_url = og;
      (nft as { image_url: string; display_image_url: string }).display_image_url = og;
    }

    // Recent trades for this wallet, so we can reflect a just-bought/just-sold
    // team before OpenSea's account index catches up, and surface what was paid.
    const trades = await getWalletTrades(owner);

    const nfts = bbb4Nfts.map(nft => {
      const { ownerAddress: _ownerAddress, ...rest } = mapOpenSeaNftToTeam(nft, owner);
      const teamRec = teamsByToken.get(nft.identifier);
      const hasBackendRecord = !!teamRec && teamRec.roster.length >= DRAFTED_ROSTER_MIN;
      const leagueId = teamRec?.leagueId ?? null;
      const pricePaid = trades.paidByToken.get(nft.identifier) ?? null;
      // Merge listing data if this token is actively listed
      const listing = listingMap.get(nft.identifier);
      if (listing) {
        return { ...rest, hasBackendRecord, leagueId, pricePaid, orderHash: listing.orderHash, price: listing.price, protocolAddress: listing.protocolAddress, listingEndTime: listing.endTime };
      }
      return { ...rest, hasBackendRecord, leagueId, pricePaid };
    });

    // Drop any team the wallet sold that's still showing (OpenSea's by-owner
    // index AND the Go draftToken backstop both keep listing sold teams — Go
    // keeps the draft record under the original drafter forever). recentSells is
    // ALL-TIME (no window), but we only ground-truth-check the ones actually
    // present in this list, so the ownerOf cost stays bounded to the stale set.
    // ownerOf is authoritative: a re-bought team passes (owner == wallet) and is
    // kept; we never hide on a null/errored read.
    let finalNfts = nfts;
    if (trades.recentSells.size > 0) {
      const presentIdSet = new Set(nfts.map(n => n.tokenId));
      const soldIds = [...trades.recentSells].filter(tid => presentIdSet.has(tid));
      if (soldIds.length > 0) {
        const confirmedSold = new Set<string>();
        await Promise.all(soldIds.map(async (tid) => {
          const onchain = await getOnchainOwner(tid);
          if (onchain && onchain !== owner.toLowerCase()) confirmedSold.add(tid);
        }));
        finalNfts = finalNfts.filter(n => !confirmedSold.has(n.tokenId));
      }
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
        const og = await resolveTokenImage(b.tokenId, owner);
        const synthetic = team
          ? { identifier: b.tokenId, contract: BBB4_CONTRACT, name: team.leagueDisplayName || null, image_url: og, display_image_url: og, traits: teamDataToTraits(team) }
          : { identifier: b.tokenId, contract: BBB4_CONTRACT, name: b.teamName, image_url: og, display_image_url: og, traits: [] };
        const { ownerAddress: _o, ...rest } = mapOpenSeaNftToTeam(synthetic as OpenSeaNft, owner);
        const listing = listingMap.get(b.tokenId);
        return {
          ...rest,
          hasBackendRecord: !!team && team.roster.length >= DRAFTED_ROSTER_MIN,
          leagueId: team?.leagueId ?? null,
          pricePaid: trades.paidByToken.get(b.tokenId) ?? null,
          ...(listing ? { orderHash: listing.orderHash, price: listing.price, protocolAddress: listing.protocolAddress, listingEndTime: listing.endTime } : {}),
        };
      }));
      finalNfts = [...added.filter((n): n is NonNullable<typeof n> => n !== null), ...finalNfts];
    }

    // Most-recent-first (Boris 2026-06-10): drafted TEAMS sort to the top by
    // league number descending (newest draft first), passes after. Stable for
    // ties so OpenSea's order is the secondary key.
    const leagueOf = (n: { tokenId: string }) => leagueByToken.get(String(n.tokenId)) ?? -1;
    finalNfts = finalNfts
      .map((n, i) => ({ n, i }))
      .sort((a, b) => (leagueOf(b.n) - leagueOf(a.n)) || (a.i - b.i))
      .map(({ n }) => n);

    respCache.set(respKey, { ts: Date.now(), nfts: finalNfts });
    return json({ nfts: finalNfts });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/nfts] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
