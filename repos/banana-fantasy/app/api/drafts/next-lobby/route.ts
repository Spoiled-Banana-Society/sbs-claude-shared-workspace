import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/drafts/next-lobby
 *
 * The partially-filled lobbies a player could land in right now, per speed —
 * the data behind the "how full is the next lobby" bar on the drafting page
 * and the entry flow's speed step.
 *
 * WHY A NUMPLAYERS RANGE QUERY, NOT A COLLECTION SCAN
 * `/api/bot/league` answers a similar question by reading the WHOLE `drafts`
 * collection (402 docs and growing as of 2026-08-01). That is fine for a bot
 * polling once a minute and completely wrong for a widget every signed-in
 * player polls. `NumPlayers >= 1 && <= 9` is a range on a SINGLE field, so it
 * rides Firestore's automatic single-field index — no composite index to
 * create — and returns only the handful of open lobbies (5 live right now).
 * Completed drafts sit at 10 and the draftTracker doc has no NumPlayers, so
 * both drop out for free.
 *
 * Do NOT "simplify" this to `where('IsLocked','==',false)`: the Go writes
 * IsLocked=false at creation and never sets it true (models/leagues.go:326 is
 * its only write), so that filter matches essentially every draft ever played.
 *
 * WHICH LOBBY IS "NEXT"
 * The matchmaker (models.scanForPartialLeague) puts you in the LOWEST-numbered
 * partial lobby you are not already in. That last clause is per-player, so the
 * route returns the candidate list and the client drops the ones it is already
 * sitting in before picking the lowest. Same rule, no per-player Firestore read.
 */

/** Slot ids the matchmaker actually hands out: `2026-fast-draft-12`. */
const LEAGUE_ID_RE = /^(\d{4})-(fast|slow)-draft-(\d+)$/;

/** Serve one Firestore round-trip to every caller inside this window. */
const CACHE_TTL_MS = 8_000;

export interface OpenLobby {
  /** Slot id — the client matches this against drafts it has already joined. */
  id: string;
  /** Trailing slot number; the matchmaker prefers the lowest. */
  slot: number;
  seats: number;
  maxSeats: number;
}

export interface NextLobbyResponse {
  fast: OpenLobby[];
  slow: OpenLobby[];
}

let cache: { at: number; body: NextLobbyResponse } | null = null;

async function readOpenLobbies(): Promise<NextLobbyResponse> {
  const snap = await getAdminFirestore()
    .collection('drafts')
    .where('NumPlayers', '>=', 1)
    .where('NumPlayers', '<=', 9)
    .get();

  type Row = OpenLobby & { year: number; speed: 'fast' | 'slow' };
  const rows: Row[] = [];

  for (const doc of snap.docs) {
    const m = LEAGUE_ID_RE.exec(doc.id);
    if (!m) continue;
    const d = doc.data() as Record<string, unknown>;

    // Wheel-won Jackpot/HOF and JackHOF lobbies run in their own lane — you
    // can't be matched into one, so they must never be reported as "next".
    // Same test the fill-alert feed uses: a special Level set WHILE filling
    // plus a name that isn't the regular "BBB #N" slot name. (Regular batch
    // JP/HOF keep the BBB name until the post-fill reveal, so this excludes
    // only the special lanes.)
    const level = String(d.Level ?? '').toLowerCase().trim();
    const name = String(d.DisplayName ?? '').trim();
    if ((level === 'jackpot' || level === 'hall of fame' || level === 'jackhof') && !/^bbb\b/i.test(name)) {
      continue;
    }

    const seats = Number(d.NumPlayers ?? 0);
    const maxSeats = Number(d.MaxPlayers ?? 10) || 10;
    if (!Number.isFinite(seats) || seats < 1 || seats >= maxSeats) continue;

    rows.push({
      id: doc.id,
      slot: Number(m[3]),
      seats,
      maxSeats,
      year: Number(m[1]),
      speed: m[2] === 'slow' ? 'slow' : 'fast',
    });
  }

  // Stranded lobbies from an earlier season prefix keep filling forever and
  // would otherwise read as the next lobby (live on 2026-08-01: the two
  // orphaned `2025-slow-draft-*` JackHOF rooms). The season the matchmaker is
  // currently handing out is the highest prefix in play — everything below it
  // is unreachable history.
  const liveYear = rows.reduce((max, r) => Math.max(max, r.year), 0);

  const forSpeed = (speed: 'fast' | 'slow') =>
    rows
      .filter((r) => r.speed === speed && r.year === liveYear)
      .sort((a, b) => a.slot - b.slot)
      .map(({ id, slot, seats, maxSeats }) => ({ id, slot, seats, maxSeats }));

  return { fast: forSpeed('fast'), slow: forSpeed('slow') };
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  const empty: NextLobbyResponse = { fast: [], slow: [] };
  if (!isFirestoreConfigured()) return json(empty);

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return json(cache.body);

  try {
    const body = await readOpenLobbies();
    cache = { at: now, body };
    return json(body);
  } catch (err) {
    logger.error('[next-lobby] read failed', { err: err instanceof Error ? err.message : String(err) });
    // The bar simply doesn't render — never block the drafting page on this.
    return json(empty);
  }
}
