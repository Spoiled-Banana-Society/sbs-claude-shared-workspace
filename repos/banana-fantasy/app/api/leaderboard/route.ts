import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { currentGameweek } from '@/lib/season';
import type { LeaderboardEntry } from '@/types';
import { bananaPlaceholderName } from '@/utils/helpers';

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

    // No weekly scores yet (before the week's first game everyone is 0 → arbitrary order): serve season order
    // instead so the board reads highest season total first until the week starts (Boris 2026-09-15).
    if (orderField === 'ScoreWeek' && (docs.length === 0 || Number(docs[0].get('ScoreWeek') ?? 0) <= 0)) {
      let q2 = col.orderBy('ScoreSeason', 'desc');
      if (level) q2 = q2.where('Level', '==', level);
      docs = (await q2.limit(limit).get()).docs;
    }
    // Players still to play this week (Boris 2026-09-21: "2/15 players left"). The scorer writes the week's
    // games + states to stats/{gw}; NFL teams with a game not yet final = "left". One extra doc read per request
    // (this response is CDN-cached 5 min), zero extra reads per row.
    const teamsLeft = new Set<string>();
    try {
      const st = (await db.collection('stats').doc(gameweek).get()).data() as { games?: Array<{ name?: string; state?: string }> } | undefined;
      for (const g of st?.games ?? []) if (g.state !== 'post') for (const t of String(g.name ?? '').split(/\s*(?:@|vs\.?)\s*/)) if (t.trim()) teamsLeft.add(t.trim().toUpperCase());
    } catch { /* no game list → no pills */ }
    const playersLeftOf = (d: Record<string, unknown>) => {
      const out: string[] = [];
      let size = 0;
      const R = (d.Roster ?? {}) as Record<string, Array<{ Team?: string; Position?: string; PlayerId?: string }>>;
      // Picks are team-position slots (PlayerId "LAR-WR1", "BUF-QB", "NE-DST"); show exactly that slot: "LAR WR1" (Boris 2026-09-21).
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'DST']) for (const p of R[pos] ?? []) {
        size++;
        const team = String(p?.Team ?? '').toUpperCase();
        if (!teamsLeft.has(team)) continue;
        const pid = String(p?.PlayerId ?? '');
        out.push(pid.includes('-') ? pid.replace('-', ' ') : `${team} ${String(p?.Position ?? pos)}`);
      }
      return { left: out, size };
    };
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
        // Never a raw wallet (brand rule): unset names come through as the wallet from the legacy PFP block.
        username: (() => { const n = String(pfp.DisplayName || '').trim(); return n && n.toLowerCase() !== owner && !/^0x[0-9a-f]{40}$/i.test(n) ? n : bananaPlaceholderName(owner); })(),
        // "Team #4566 · League #392" (Boris 2026-09-21): label both numbers; the type (Pro/HOF/…) is a colored tag from `level`.
        teamName: (() => { const ln = String(card.LeagueDisplayName || card.LeagueId || ''); const m = ln.match(/#\s*(\d+)/); return `Team #${String(card.RealTokenId || cardId)} · League ${m ? `#${m[1]}` : ln}`; })(),
        seasonScore: Number(d.ScoreSeason ?? 0),
        weeklyScore: Number(d.ScoreWeek ?? 0),
        isCurrentUser: !!me && owner === me,
        ownerWallet: owner,
        leagueId: String(card.LeagueId ?? ''),
        leagueName: String(card.LeagueDisplayName ?? ''),
        cardId,
        level: String(d.Level ?? card.Level ?? ''),
        ...(() => { if (!teamsLeft.size) return { playersLeft: [] as string[], rosterSize: 0 }; const r = playersLeftOf(d); return { playersLeft: r.left, rosterSize: r.size }; })(),
      };
    });
    // Season 2026-09-10: CDN-cached 5 min per URL (wallet is in the query string, so per-user rows stay per-user).
    return json(rows, { status: 200, headers: { 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' } });
  } catch (err) {
    console.error('Leaderboard fetch failed:', err);
    return jsonError('Failed to fetch leaderboard', 500);
  }
}
