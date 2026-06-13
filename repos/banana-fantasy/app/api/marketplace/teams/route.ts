import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import {
  type DraftType,
  type MarketplaceTeam,
} from '@/lib/opensea';
import { getAllRecentCachedListings } from '@/lib/marketplace/listingCache';
import { currentMaxTokenId, isRealToken } from '@/lib/onchain/contractSupply';

export const dynamic = 'force-dynamic';

function colorForDraftType(dt: DraftType): string {
  return dt === 'jackpot' ? 'from-error to-red-700' : dt === 'hof' ? 'from-hof to-pink-600' : 'from-pro to-blue-600';
}

// Short cache per filter (all/level/league) so rapid tab-switching is instant and
// doesn't re-hit Firestore + OpenSea every click.
const teamsCache = new Map<string, { ts: number; nfts: MarketplaceTeam[] }>();
// 3s (was 10s): a just-closed draft's teams + league should appear in the
// marketplace browse near-real-time, not up to 10s later.
const TEAMS_TTL_MS = 3_000;

/**
 * GET /api/marketplace/teams?level=jackpot|hof&league=N
 *
 * Reads the marketplace straight from the BACKEND INDEX (marketplace_index,
 * keyed by on-chain id, stamped from the metadata route). Instant filtering by
 * level + league — no OpenSea page-scanning, no cardId decoding. OpenSea is only
 * overlaid for live price/owner on listed teams (it stays the trading layer).
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Index not configured', 503);

  try {
    const level = (getSearchParam(req, 'level') || '').toLowerCase();
    const leagueParam = getSearchParam(req, 'league');
    const teamParam = getSearchParam(req, 'team');
    const hasLeague = !!leagueParam && /^\d+$/.test(leagueParam);
    const hasTeam = !!teamParam && /^\d+$/.test(teamParam);
    const wantLevel = level === 'jackpot' || level === 'hof' ? level : null;

    // Instant path: serve the cached section if still fresh.
    const cacheKey = `${wantLevel ?? ''}|${hasLeague ? leagueParam : ''}|${hasTeam ? teamParam : ''}`;
    const cached = teamsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TEAMS_TTL_MS) {
      return json({ nfts: cached.nfts, next: null });
    }

    const db = getAdminFirestore();

    // Team # is the on-chain token id = the index doc id → one direct read.
    // Otherwise query ONE field (single-field indexes are automatic; no composite
    // index needed) and filter the rest in code.
    let snapDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    if (hasTeam) {
      const one = await db.collection('marketplace_index').doc(teamParam!).get();
      snapDocs = one.exists ? [one as FirebaseFirestore.QueryDocumentSnapshot] : [];
    } else {
      let q: FirebaseFirestore.Query = db.collection('marketplace_index');
      if (hasLeague) q = q.where('leagueNumber', '==', Number(leagueParam));
      else if (wantLevel) q = q.where('level', '==', wantLevel);
      else q = q.where('status', '==', 'team'); // "All Teams" — only drafted teams
      snapDocs = (await q.limit(1000).get()).docs;
    }
    const snap = { docs: snapDocs };

    // Only real on-chain tokens (<= current contract supply). Excludes prior-era
    // "ghost" finalize-doc ids that aren't minted on this contract / on OpenSea,
    // so the marketplace counts + filters match exactly what's on-chain.
    const maxId = await currentMaxTokenId();

    const teams: MarketplaceTeam[] = snap.docs
      .map((d) => d.data())
      .filter((x) => x.status === 'team' && (!wantLevel || x.level === wantLevel) && isRealToken(String(x.tokenId), maxId))
      .map((x) => {
      const lvl = (x.level as DraftType) || 'pro';
      const tokenId = String(x.tokenId);
      return {
        id: tokenId,
        tokenId,
        name: `Team #${tokenId}`,
        draftType: lvl,
        isHof: lvl === 'hof',
        isJackpot: lvl === 'jackpot',
        rank: 0,
        points: 0,
        weeklyAvg: 0,
        playoffOdds: 0,
        price: null,
        owner: '',
        ownerAddress: '',
        ownerPfp: null,
        roster: Array.isArray(x.roster) ? (x.roster as string[]) : [],
        color: colorForDraftType(lvl),
        imageUrl: (x.image as string) || null,
        orderHash: null,
        protocolAddress: null,
        leagueNumber: x.leagueNumber ?? null,
      };
    });

    // Overlay live price/owner from OUR backend listings cache (active_listings in
    // Firestore — written every time someone lists through the app). 100% backend,
    // no OpenSea API on the page-load path. BEST-EFFORT: a listings hiccup must
    // NEVER blank the section; on failure we still return every team, just without
    // prices. (The actual orders still live/settle on Seaport — this is only the
    // display mirror.)
    try {
      const active = (await getAllRecentCachedListings()).filter((l) => l.status === 'active');
      const byId = new Map(active.map((l) => [String(l.tokenId), l]));
      for (const t of teams) {
        const l = byId.get(t.tokenId);
        if (l) {
          t.price = l.priceUsd;
          t.orderHash = l.orderHash;
          t.protocolAddress = l.protocolAddress;
          t.ownerAddress = l.offerer;
          t.owner = `${l.offerer.slice(0, 6)}...${l.offerer.slice(-4)}`;
        }
      }
    } catch (e) {
      console.warn('[marketplace/teams] listings overlay failed (serving teams without prices):', e);
    }

    // Most-recent-first (Boris 2026-06-10): newest league at the top of All
    // Teams / Pro / JP / HOF, token id desc breaking ties within a league.
    teams.sort((a, b) =>
      ((b.leagueNumber ?? -1) - (a.leagueNumber ?? -1)) || (Number(b.tokenId) - Number(a.tokenId)),
    );

    teamsCache.set(cacheKey, { ts: Date.now(), nfts: teams });
    return json({ nfts: teams, next: null });
  } catch (err) {
    console.error('[marketplace/teams] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
