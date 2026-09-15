/**
 * GET /api/teams/token-stats?tokenIds=1,2,3 — live in-season numbers for specific team tokens, straight from the
 * scorer-stamped token records. Used for BOUGHT teams on My Teams (2026-09-15, vertig0): those rows come from the
 * marketplace path, not the owner's Go token list, so they had no rank/score and no league to open.
 * Scores are public. One read per token, batched 30 per query, CDN-cached 5 min per URL.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export interface TokenStats {
  tokenId: string;
  leagueId: string;
  leagueName: string;
  level: string;
  leagueRank: number;
  weeklyRank: number;
  weeklyScore: number;
  seasonScore: number;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function pick(id: string, d: Record<string, unknown>): TokenStats {
  return {
    tokenId: id, leagueId: String(d.LeagueId ?? ''), leagueName: String(d.LeagueDisplayName ?? ''), level: String(d.Level ?? 'Pro'),
    leagueRank: num(d.LeagueRank), weeklyRank: num(d.Rank), weeklyScore: num(d.WeekScore), seasonScore: num(d.SeasonScore),
  };
}

export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  if (!isFirestoreConfigured()) return json({ stats: {} });
  const ids = Array.from(new Set((getSearchParam(req, 'tokenIds') || '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))).slice(0, 200);
  if (!ids.length) return jsonError('tokenIds required', 400);
  const db = getAdminFirestore();
  const stats: Record<string, TokenStats> = {};
  const missing: string[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection('draftTokens').where(FieldPath.documentId(), 'in', ids.slice(i, i + 30)).get();
    const seen = new Set<string>();
    for (const d of snap.docs) {
      const x = d.data() as Record<string, unknown>; seen.add(d.id);
      if (x.LeagueId) stats[d.id] = pick(d.id, x); else missing.push(d.id);
    }
    for (const id of ids.slice(i, i + 30)) if (!seen.has(id)) missing.push(id);
  }
  // Wheel/promo seats: the scored record is the special card whose RealTokenId is this token.
  for (const id of missing) {
    const q = await db.collection('draftTokens').where('RealTokenId', '==', id).limit(1).get();
    if (!q.empty) stats[id] = pick(id, q.docs[0].data() as Record<string, unknown>);
  }
  return json({ stats }, { status: 200, headers: { 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' } });
}
