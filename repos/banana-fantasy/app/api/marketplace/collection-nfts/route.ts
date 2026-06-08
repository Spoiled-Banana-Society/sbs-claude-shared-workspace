import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import {
  OPENSEA_API_BASE,
  COLLECTION_SLUG,
  mapOpenSeaNftToTeam,
  type MarketplaceTeam,
  type OpenSeaNft,
  type OpenSeaListing,
} from '@/lib/opensea';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

/**
 * Overlay our canonical card image + league number from the marketplace_index.
 * OpenSea serves a CDN-resized image (i2c.seadn.io) that crops our 4:5 obsidian
 * card, so a team here looked cut-off while the index-sourced views were clean.
 * The index holds the exact `/api/og/team-card` URL (and the corrected league #),
 * so prefer it whenever the token is indexed. Best-effort; never throws.
 */
async function overlayIndexImages(teams: MarketplaceTeam[]): Promise<void> {
  if (!isFirestoreConfigured() || teams.length === 0) return;
  try {
    const db = getAdminFirestore();
    const ids = [...new Set(teams.map((t) => t.tokenId).filter((id) => /^\d+$/.test(id)))];
    const byId = new Map<string, { image?: string; leagueNumber?: number | null }>();
    for (let i = 0; i < ids.length; i += 300) {
      const refs = ids.slice(i, i + 300).map((id) => db.collection('marketplace_index').doc(id));
      const snaps = await db.getAll(...refs);
      for (const s of snaps) {
        if (!s.exists) continue;
        const d = s.data() as Record<string, unknown>;
        if (d.status === 'team') byId.set(s.id, { image: d.image as string, leagueNumber: (d.leagueNumber as number) ?? null });
      }
    }
    for (const t of teams) {
      const idx = byId.get(t.tokenId);
      if (idx?.image) t.imageUrl = idx.image;
      if (idx && idx.leagueNumber != null) t.leagueNumber = idx.leagueNumber;
    }
  } catch { /* keep OpenSea images */ }
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

    // Cross-reference active listings for price/owner (best-effort).
    const listingsMap = new Map<string, OpenSeaListing>();
    try {
      const listingsRes = await fetch(
        `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
        { headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY }, cache: 'no-store' },
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

    // Enrich with SBS owner profiles (bounded by unique owners).
    const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
      || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
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

    // Prefer our clean obsidian card image (+ corrected league #) over OpenSea's
    // cropped CDN image for any team we've indexed.
    await overlayIndexImages(teams);

    return json({ nfts: teams, next });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[marketplace/collection-nfts] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
