import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { currentGameweek } from '@/lib/season';
import type { LeaderboardEntry } from '@/types';

/**
 * Global leaderboard — reads the scorer's output directly from Firestore
 * (`draftTokenLeaderboard/{gameweek}/cards`, one CardScores doc per drafted
 * team, written by scripts/espn-scorer.mjs). The Go route this used to proxy
 * (`/league/leaderboard/global/...`) never existed (404 all season).
 *
 * Query: gameweek (default: current), orderBy (season|week, default season),
 * level (all|Pro|HOF|Jackpot|JackHOF), limit (<= 500), wallet (marks isCurrentUser).
 * Returns LeaderboardEntry[] plus ownerWallet/leagueId/cardId/level per row.
 */
const LEVEL_MAP: Record<string, string> = {
  pro: 'Pro',
  hof: 'Hall of Fame',
  'hall of fame': 'Hall of Fame',
  jackpot: 'Jackpot',
  jackhof: 'JackHOF',
};

type Row = LeaderboardEntry & {
  ownerWallet: string;
  leagueId: string;
  leagueName: string;
  cardId: string;
  level: string;
};

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    if (!isFirestoreConfigured()) return jsonError('Leaderboard not configured', 503);
    const gameweek = getSearchParam(req, 'gameweek') || currentGameweek();
    if (!/^\d{4}REG-\d{2}$/.test(gameweek)) return jsonError('Invalid gameweek', 400);
    const orderRaw = (getSearchParam(req, 'orderBy') || 'season').toLowerCase();
    const orderField = orderRaw.includes('week') ? 'ScoreWeek' : 'ScoreSeason';
    const levelRaw = (getSearchParam(req, 'level') || 'all').toLowerCase();
    const level = levelRaw === 'all' ? null : LEVEL_MAP[levelRaw] ?? null;
    if (levelRaw !== 'all' && !level) return jsonError('Invalid level', 400);
    const limit = Math.min(500, Math.max(1, parseInt(getSearchParam(req, 'limit') || '200', 10) || 200));
    const me = (getSearchParam(req, 'wallet') || '').toLowerCase();

    const db = getAdminFirestore();
    const col = db.collection(`draftTokenLeaderboard/${gameweek}/cards`);
    let docs: FirebaseFirestore.QueryDocumentSnapshot[];
    try {
      let q = col.orderBy(orderField, 'desc');
      if (level) q = q.where('Level', '==', level);
      docs = (await q.limit(limit).get()).docs;
    } catch (err) {
      // Level + score composite index still building (created 9/9): order
      // only, filter the level in memory from a deeper slice.
      if (!level || !/index/i.test(String((err as Error)?.message))) throw err;
      const wide = await col.orderBy(orderField, 'desc').limit(3000).get();
      docs = wide.docs.filter((d) => d.get('Level') === level).slice(0, limit);
    }

    // competition ranking: equal scores share a rank (pre-kickoff everyone is #1)
    let rank = 0;
    let prevKey = '';
    const rows: Row[] = docs.map((doc, i) => {
      const d = doc.data() as Record<string, unknown>;
      const key = `${Number(d.ScoreWeek ?? 0)}|${Number(d.ScoreSeason ?? 0)}`;
      if (i === 0 || key !== prevKey) rank = i + 1;
      prevKey = key;
      const card = (d.Card ?? {}) as Record<string, unknown>;
      const pfp = (d.PFP ?? {}) as Record<string, unknown>;
      const owner = String(d.OwnerId ?? card.OwnerId ?? '').toLowerCase();
      const cardId = String(d.CardId ?? doc.id);
      return {
        rank,
        username: String(pfp.DisplayName || ''),
        teamName: `${String(card.LeagueDisplayName || card.LeagueId || '')} · #${String(card.RealTokenId || cardId)}`,
        seasonScore: Number(d.ScoreSeason ?? 0),
        weeklyScore: Number(d.ScoreWeek ?? 0),
        isCurrentUser: !!me && owner === me,
        ownerWallet: owner,
        leagueId: String(card.LeagueId ?? ''),
        leagueName: String(card.LeagueDisplayName ?? ''),
        cardId,
        level: String(d.Level ?? card.Level ?? ''),
      };
    });
    return json(rows, 200);
  } catch (err) {
    console.error('Leaderboard fetch failed:', err);
    return jsonError('Failed to fetch leaderboard', 500);
  }
}
