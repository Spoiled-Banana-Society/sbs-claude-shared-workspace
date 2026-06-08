import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import {
  type DraftType,
  type MarketplaceTeam,
} from '@/lib/opensea';
import { getCollectionListings } from '@/lib/marketplace/collectionListings';
import { currentMaxTokenId, isRealToken } from '@/lib/onchain/contractSupply';

export const dynamic = 'force-dynamic';

function colorForDraftType(dt: DraftType): string {
  return dt === 'jackpot' ? 'from-error to-red-700' : dt === 'hof' ? 'from-hof to-pink-600' : 'from-pro to-blue-600';
}

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
    const hasLeague = !!leagueParam && /^\d+$/.test(leagueParam);
    const wantLevel = level === 'jackpot' || level === 'hof' ? level : null;
    const db = getAdminFirestore();

    // Query ONE field (single-field indexes are automatic; no composite index
    // needed), then filter the rest in code.
    let q: FirebaseFirestore.Query = db.collection('marketplace_index');
    if (hasLeague) q = q.where('leagueNumber', '==', Number(leagueParam));
    else if (wantLevel) q = q.where('level', '==', wantLevel);
    else q = q.where('status', '==', 'team'); // "All Teams" — only drafted teams

    const snap = await q.limit(1000).get();

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

    // Overlay OpenSea listings for live price/owner on listed teams. Shared 15s
    // cache so the Jackpot/HOF/League filters don't re-fetch it every call.
    const byId = await getCollectionListings();
    for (const t of teams) {
      const l = byId.get(t.tokenId);
      if (l) {
        const v = l.price?.current?.value;
        const dec = l.price?.current?.decimals ?? 18;
        t.price = v ? Number(v) / Math.pow(10, dec) : null;
        t.orderHash = l.order_hash;
        t.protocolAddress = l.protocol_address;
        t.ownerAddress = l.protocol_data.parameters.offerer;
        t.owner = `${t.ownerAddress.slice(0, 6)}...${t.ownerAddress.slice(-4)}`;
      }
    }

    return json({ nfts: teams, next: null });
  } catch (err) {
    console.error('[marketplace/teams] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
