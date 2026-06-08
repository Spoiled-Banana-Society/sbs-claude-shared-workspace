import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getOnchainOwner } from '@/lib/onchain/ownerOf';

export const dynamic = 'force-dynamic';

const DRAFTS_API = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL
  || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * GET /api/marketplace/league-ownership?wallet=0x..&leagues=id1,id2
 *
 * Returns which of the given drafted leagues the wallet NO LONGER owns on-chain
 * (i.e. sold). My Teams is built from the draft backend, which keeps a team
 * under its original drafter forever — so a sold team would otherwise keep
 * showing. Callers pass only the leagues they can't already confirm as owned
 * (from the owned-NFT list), so we on-chain check just the discrepancies — and
 * never hide a freshly-drafted team that OpenSea simply hasn't indexed yet.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const wallet = getSearchParam(req, 'wallet');
    const leaguesParam = getSearchParam(req, 'leagues');
    if (!wallet) return jsonError('Missing wallet', 400);
    const leagueIds = (leaguesParam || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
    if (leagueIds.length === 0) return json({ notOwned: [] });

    // The drafter's record carries leagueId → realTokenId for every team they
    // drafted (sold ones included — the backend keeps them).
    let tokens: Array<{ realTokenId?: string | number; _cardId?: string; _leagueId?: string }> = [];
    try {
      const res = await fetch(`${DRAFTS_API}/owner/${wallet.toLowerCase()}/draftToken/all`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        tokens = [
          ...(Array.isArray(data?.active) ? data.active : []),
          ...(Array.isArray(data?.available) ? data.available : []),
        ];
      }
    } catch { /* fall through — no tokens means we can't verify, so hide nothing */ }

    // Resolve the on-chain token id: realTokenId when set, else decode it from
    // the cardId (bare id, or staging `<10-digit-secs><tokenId>`). Drafted teams
    // usually have NO realTokenId, so without this decode they'd be skipped and
    // a sold team would keep showing as owned.
    const onchainId = (t: { realTokenId?: string | number; _cardId?: string }): string => {
      const rt = String(t.realTokenId ?? '').trim();
      if (/^\d+$/.test(rt)) return rt;
      const c = String(t._cardId ?? '').trim();
      if (/^\d{1,7}$/.test(c)) return c;
      if (/^\d{10}\d{1,7}$/.test(c)) return c.slice(10);
      return '';
    };
    const tokenByLeague = new Map<string, string>();
    for (const t of tokens) {
      const lid = String(t._leagueId ?? '');
      const tid = onchainId(t);
      if (lid && tid) tokenByLeague.set(lid, tid);
    }

    const notOwned = (await Promise.all(
      leagueIds.map(async (leagueId) => {
        const tokenId = tokenByLeague.get(leagueId);
        if (!tokenId) return null; // can't map → don't hide (be conservative)
        const owner = await getOnchainOwner(tokenId);
        if (owner && owner !== wallet.toLowerCase()) return leagueId; // sold
        return null;
      }),
    )).filter((x): x is string => x !== null);

    return json({ notOwned });
  } catch {
    return jsonError('Failed to check league ownership', 500);
  }
}
