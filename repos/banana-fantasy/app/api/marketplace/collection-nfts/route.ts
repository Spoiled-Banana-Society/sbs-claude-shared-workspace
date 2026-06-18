import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  COLLECTION_SLUG,
  mapOpenSeaNftToTeam,
  type MarketplaceTeam,
  type OpenSeaNft,
} from '@/lib/opensea';
import { getServerDraftsApiUrl } from '@/lib/serverDraftsApiUrl';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getCollectionListings } from '@/lib/marketplace/collectionListings';

function colorForLevel(level: string): string {
  return level === 'jackpot' ? 'from-error to-red-700' : level === 'hof' ? 'from-hof to-pink-600' : 'from-pro to-blue-600';
}

/**
 * Make the marketplace_index the SOURCE OF TRUTH for every token OpenSea returns.
 * OpenSea serves a CDN-cropped image (i2c.seadn.io) AND can be stale on staging
 * (a reused-era id it still labels a "team" is really a pass in our backend). So
 * for any indexed token we override the card with OUR data + clean `/api/og/
 * team-card` image — NEVER OpenSea's. Reused-id passes get `roster: []` so the
 * page's existing "hide passes" filter drops them from the teams grid. Best-
 * effort; never throws.
 */
async function overlayIndexData(teams: MarketplaceTeam[]): Promise<void> {
  if (!isFirestoreConfigured() || teams.length === 0) return;
  try {
    const db = getAdminFirestore();
    const ids = [...new Set(teams.map((t) => t.tokenId).filter((id) => /^\d+$/.test(id)))];
    const byId = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += 300) {
      const refs = ids.slice(i, i + 300).map((id) => db.collection('marketplace_index').doc(id));
      const snaps = await db.getAll(...refs);
      for (const s of snaps) if (s.exists) byId.set(s.id, s.data() as Record<string, unknown>);
    }
    for (const t of teams) {
      const idx = byId.get(t.tokenId);
      if (!idx) continue;
      // Always our image — never OpenSea's cropped CDN copy.
      if (idx.image) t.imageUrl = idx.image as string;
      if (idx.status === 'team') {
        const lvl = String(idx.level || 'pro');
        t.draftType = lvl as MarketplaceTeam['draftType'];
        t.isJackpot = lvl === 'jackpot';
        t.isHof = lvl === 'hof';
        t.color = colorForLevel(lvl);
        t.leagueNumber = (idx.leagueNumber as number) ?? null;
        if (Array.isArray(idx.roster) && idx.roster.length) t.roster = idx.roster as string[];
        t.name = `Team #${t.tokenId}`;
      } else {
        // Our backend says this id is an undrafted pass (stale OpenSea "team").
        // Empty roster → the marketplace's hide-passes filter removes it.
        t.roster = [];
      }
    }
  } catch { /* keep OpenSea data */ }
}

export const dynamic = 'force-dynamic';
// A `level` scan walks many OpenSea pages server-side, so allow more time.
export const maxDuration = 60;

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

/** Fetch one page of collection NFTs (token 0 filtered out). */
async function fetchNftPage(cursor: string | null): Promise<{ nfts: OpenSeaNft[]; next: string | null }> {
  const params = new URLSearchParams({ limit: '50' });
  if (cursor) params.set('next', cursor);
  const res = await fetch(`${OPENSEA_API_BASE}/api/v2/collection/${COLLECTION_SLUG}/nfts?${params}`, {
    headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[collection-nfts] OpenSea error:', res.status, text);
    throw new ApiError(res.status >= 500 ? 502 : res.status, 'Failed to fetch NFTs');
  }
  const data = await res.json();
  const nfts: OpenSeaNft[] = (data.nfts ?? []).filter((n: OpenSeaNft) => n.identifier !== '0');
  return { nfts, next: data.next ?? null };
}

/**
 * GET /api/marketplace/collection-nfts?limit=50&cursor=...   (paged browse)
 * GET /api/marketplace/collection-nfts?level=jackpot|hof      (full level scan)
 *
 * Default: one page of the collection (listed + unlisted).
 * `level`: Jackpot (1%) and HOF (5%) are too rare to appear in a single page, so
 * client-side filtering over a page shows "No Teams Found". This scans the whole
 * collection server-side and returns only that level's teams — keyed by on-chain
 * id with correct images/traits (OpenSea is the reliable source; the backend's
 * staging card records lack on-chain ids). Capped + time-boxed for safety.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    if (!OPENSEA_API_KEY) return jsonError('OpenSea API key not configured', 503);

    const levelParam = (getSearchParam(req, 'level') || '').toLowerCase();
    const wantLevel: 'jackpot' | 'hof' | null =
      levelParam === 'jackpot' ? 'jackpot' : levelParam === 'hof' ? 'hof' : null;

    let teams: MarketplaceTeam[] = [];
    let next: string | null = null;

    if (wantLevel) {
      // Full scan: walk pages, keep only the requested level. Cap pages so a
      // single request stays well within maxDuration.
      const MAX_PAGES = 40; // 40 * 50 = 2000 tokens (whole BBB4 collection fits)
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { nfts, next: pageNext } = await fetchNftPage(cursor);
        for (const nft of nfts) {
          const team = mapOpenSeaNftToTeam(nft, '');
          if (wantLevel === 'jackpot' ? team.isJackpot : team.isHof) teams.push(team);
        }
        if (!pageNext) break;
        cursor = pageNext;
      }
    } else {
      const cursor = getSearchParam(req, 'cursor');
      const { nfts, next: pageNext } = await fetchNftPage(cursor);
      teams = nfts.map((nft) => mapOpenSeaNftToTeam(nft, ''));
      next = pageNext;
    }

    // Cross-reference active listings for price/owner (shared 15s cache).
    const listingsMap = await getCollectionListings();

    for (const team of teams) {
      const listing = listingsMap.get(team.tokenId);
      if (listing) {
        const value = listing.price?.current?.value;
        const decimals = listing.price?.current?.decimals ?? 18;
        team.price = value ? Number(value) / Math.pow(10, decimals) : null;
        team.orderHash = listing.order_hash;
        team.protocolAddress = listing.protocol_address;
        team.ownerAddress = listing.protocol_data.parameters.offerer;
        team.owner = `${team.ownerAddress.slice(0, 6)}...${team.ownerAddress.slice(-4)}`;
      }
    }

    // Enrich with SBS owner profiles
    const DRAFTS_API = getServerDraftsApiUrl();
    try {
      const uniqueOwners = [...new Set(teams.filter(n => n.ownerAddress).map(n => n.ownerAddress.toLowerCase()))];
      const ownerProfiles = new Map<string, { name: string; pfp: string | null }>();
      await Promise.all(
        uniqueOwners.map(async (addr) => {
          try {
            const res = await fetch(`${DRAFTS_API}/owner/${addr}`, { signal: AbortSignal.timeout(2500) });
            if (!res.ok) return;
            const profile = await res.json();
            if (profile?.pfp?.displayName || profile?.pfp?.imageUrl) {
              ownerProfiles.set(addr, { name: profile.pfp?.displayName || '', pfp: profile.pfp?.imageUrl || null });
            }
          } catch { /* skip */ }
        }),
      );
      for (const team of teams) {
        const profile = ownerProfiles.get(team.ownerAddress.toLowerCase());
        if (profile) {
          if (profile.name) team.owner = profile.name;
          if (profile.pfp) team.ownerPfp = profile.pfp;
        }
      }
    } catch { /* enrichment failed */ }

    // Make our backend index authoritative: our clean card image + data for
    // every indexed token, never OpenSea's cropped/stale copy.
    await overlayIndexData(teams);

    // Wheel-won JP/HOF passes listed while their draft fills: the NFT's tier
    // stamp doesn't exist yet, so attach the live wheel level (same as the
    // listings route) — drives the gold/red badge + tier-view filters. Only
    // listed empty-roster tokens can be wheel passes, so the lookup is tiny.
    try {
      const passTokens = teams.filter(t => t.roster.length === 0 && t.orderHash).map(t => t.tokenId);
      if (passTokens.length > 0) {
        const { getFillingWheelPassLevels } = await import('@/lib/db');
        const levels = await getFillingWheelPassLevels(passTokens);
        for (const team of teams) {
          const lvl = levels[String(team.tokenId)];
          if (lvl) team.fillingWheelLevel = lvl;
        }
      }
    } catch { /* badge enrichment is best-effort */ }

    return json({ nfts: teams, next });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/collection-nfts] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
