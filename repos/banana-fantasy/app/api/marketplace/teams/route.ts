import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import {
  OPENSEA_API_BASE,
  COLLECTION_SLUG,
  type DraftType,
  type MarketplaceTeam,
} from '@/lib/opensea';

export const dynamic = 'force-dynamic';

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || '';

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

    const snap = await q.limit(1000).get();

    const teams: MarketplaceTeam[] = snap.docs
      .map((d) => d.data())
      .filter((x) => x.status === 'team' && (!wantLevel || x.level === wantLevel))
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

    // Overlay OpenSea listings for live price/owner on listed teams (one call).
    if (OPENSEA_API_KEY) {
      try {
        const res = await fetch(
          `${OPENSEA_API_BASE}/api/v2/listings/collection/${COLLECTION_SLUG}/all?limit=50`,
          { headers: { accept: 'application/json', 'x-api-key': OPENSEA_API_KEY }, cache: 'no-store' },
        );
        if (res.ok) {
          const data = await res.json();
          const byId = new Map<string, { price?: { current?: { value?: string; decimals?: number } }; order_hash: string; protocol_address: string; protocol_data: { parameters: { offerer: string } } }>();
          for (const l of (data.listings ?? [])) {
            const off = l.protocol_data.parameters.offer.find((o: { itemType: number }) => o.itemType === 2 || o.itemType === 3);
            if (off?.identifierOrCriteria) byId.set(off.identifierOrCriteria, l);
          }
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
        }
      } catch { /* listings are best-effort overlay */ }
    }

    return json({ nfts: teams, next: null });
  } catch (err) {
    console.error('[marketplace/teams] GET failed:', err);
    return jsonError('Internal Server Error', 500);
  }
}
