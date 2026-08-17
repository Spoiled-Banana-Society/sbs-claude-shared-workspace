import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = 'force-dynamic';

import { jsonError, json } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/owner/active-drafts?wallet=<address>
 *
 * Server-side source of truth for "which drafts is this wallet seated in RIGHT
 * NOW". The client's `banana-active-drafts` store is localStorage-only — it only
 * knows about joins that happened ON THIS device, so a seat taken on a different
 * device/session (or where the local write raced) is invisible even though it's
 * real. Users reported this as "I joined but the draft doesn't show up on my app"
 * (2026-07-23). This endpoint lets the client HYDRATE any missing seats.
 *
 * Source of truth: `owners/{wallet}/usedDraftTokens` — the join stamps `LeagueId`
 * on the token here (leagues.go:497 / draft-token.go:469) and LEAVE deletes it,
 * so this collection lists every draft the wallet holds a seat in. It is NOT
 * pruned on completion, so it also holds every finished draft — we filter those
 * out below.
 *
 * SCOPE — filling AND actively-drafting, but NOT completed:
 *   The earlier version returned filling-only, which broke the moment a lobby
 *   filled: a draft that's 10/10 and being drafted vanished from the endpoint, so
 *   users whose lobby had already started STILL couldn't see it cross-device
 *   ("some see it, some don't", 2026-07-23). We now include drafting drafts too.
 *   Completed vs drafting can't be told from the league doc (IsLocked is never
 *   set true in Go; a full doc looks identical whether picking or done), so for
 *   full lobbies we ask the Go state endpoint:
 *     - "draft state not yet initialized" → still filling / revealing  → include
 *     - pickNumber < TOTAL_PICKS                → actively drafting     → include
 *     - pickNumber >= TOTAL_PICKS (150 = 10×15) → check the final pick:
 *         summary slot 150 has no player       → still drafting        → include
 *         summary slot 150 has a player        → completed             → EXCLUDE
 *   To keep this cheap for veterans with hundreds of finished drafts, only the
 *   most-recent RECENT_SLOTS ids per speed are considered — any active draft is
 *   near the current fill frontier; old completed slots are dropped without a
 *   single read.
 */

const LEAGUE_ID_RE = /^\d{4}-(fast|slow)-draft-(\d+)$/;
const TOTAL_PICKS = 150; // 10 players × 15 rounds — a draft at pick 150 is done.
// Per speed. Tokens whose Roster already holds all 15 picks are dropped first
// (that draft is finished — no Go call needed), so this only bounds the
// not-yet-finished set. Was 30 with no roster pre-filter: a whale with 37 live
// slow drafts across 55 slots (vertig0, 2026-08-16) had his 7 oldest live
// drafts silently outside the window.
const RECENT_SLOTS = 60;
const ROSTER_SLOTS = 15; // 15 rounds → a token with 15 rostered players is done.
const GO_VERIFY_CONCURRENCY = 8;

const GO_API = (
  process.env.STAGING_DRAFTS_API_URL ||
  process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
  'https://sbs-drafts-api-staging-652484219017.us-central1.run.app'
).replace(/\/$/, '');

// Go writes these via firestore Set(struct) — the client uses the GO FIELD
// NAME (PascalCase), NOT the struct's json tags. So the stored fields are
// `LeagueId`/`PassType`/`CardId`, not `_leagueId`. Lowercase/underscore
// variants are kept only as defensive fallbacks (see passLedger.ts:47).
interface UsedToken {
  LeagueId?: string;
  Roster?: Record<string, unknown[] | null | undefined>;
  PassType?: string;
  CardId?: string;
  _leagueId?: string;
  passType?: string;
  _cardId?: string;
}

interface LeagueDoc {
  DisplayName?: string;
  NumPlayers?: number;
  MaxPlayers?: number;
  DraftType?: string;
  IsLocked?: boolean;
}

type Status = 'filling' | 'drafting';

function slotOf(id: string): number {
  const m = LEAGUE_ID_RE.exec(id);
  return m ? Number(m[2]) : -1;
}

/**
 * Is the FINAL pick still unmade? Go clamps `pickNumber` at TOTAL_PICKS, so a
 * draft sitting on its last pick and a draft that finished look identical in
 * /state/info (both report 150, both name a currentDrafter). The only way to
 * tell them apart is the summary: the pick-150 slot exists either way, but its
 * player name is empty until the pick is actually made.
 *
 * This matters because the last drafter is on the clock for up to 8 hours on a
 * slow draft, and calling that "completed" hid the draft from the one person
 * who needed to find it (FC / BBB #183, 2026-07-31).
 *
 * Only called for drafts already known to be at pick >= TOTAL_PICKS, so the
 * extra (heavier) summary fetch stays rare. Any failure returns false = treat
 * as completed, i.e. we keep the old behavior rather than leak finished drafts.
 */
async function finalPickPending(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${GO_API}/draft/${id}/state/summary`, { cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      summary?: Array<{ playerInfo?: { displayName?: string } }>;
    };
    const picks = Array.isArray(body?.summary) ? body.summary : [];
    if (picks.length < TOTAL_PICKS) return false;
    return !(picks[TOTAL_PICKS - 1]?.playerInfo?.displayName ?? '').trim();
  } catch {
    return false;
  }
}

/** Ask Go whether a full lobby is drafting (include) or completed (exclude). */
async function goStatus(id: string): Promise<Status | 'completed' | 'unknown'> {
  try {
    const res = await fetch(`${GO_API}/draft/${id}/state/info`, { cache: 'no-store' });
    if (res.status === 404) return 'unknown';
    const text = await res.text();
    if (/not yet initialized/i.test(text)) return 'filling';
    let pick = NaN;
    try { pick = Number((JSON.parse(text) as { pickNumber?: number }).pickNumber); } catch { /* non-JSON */ }
    if (!Number.isFinite(pick)) return 'unknown';
    if (pick < TOTAL_PICKS) return 'drafting';
    // At the frontier: still drafting if that last pick hasn't been made yet.
    return (await finalPickPending(id)) ? 'drafting' : 'completed';
  } catch {
    return 'unknown';
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(req.url);
    const wallet = (searchParams.get('wallet') ?? searchParams.get('userId') ?? '').trim().toLowerCase();
    if (!wallet) return jsonError('Missing wallet', 400);

    if (!isFirestoreConfigured()) return json({ drafts: [] });

    const db = getAdminFirestore();

    // 1) Every seat the wallet currently holds a pass for.
    const usedSnap = await db.collection(`owners/${wallet}/usedDraftTokens`).get();
    if (usedSnap.empty) return json({ drafts: [] });

    const byLeague = new Map<string, UsedToken>();
    for (const doc of usedSnap.docs) {
      const t = (doc.data() ?? {}) as UsedToken;
      const leagueId = (t.LeagueId ?? t._leagueId ?? '').trim();
      if (!leagueId || !LEAGUE_ID_RE.test(leagueId)) continue;
      // Finished draft: Go writes the full 15-player roster onto the token
      // when the draft completes. Skip without a read (same test the client's
      // token poll uses to hide completed rows).
      const rosterCount = Object.values(t.Roster ?? {}).reduce<number>(
        (n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0,
      );
      if (rosterCount >= ROSTER_SLOTS) continue;
      if (!byLeague.has(leagueId)) byLeague.set(leagueId, t);
    }
    if (byLeague.size === 0) return json({ drafts: [] });

    // 2) Only the most-recent slots per speed can be live — drop old completed
    //    ids up front so a veteran's hundreds of finished drafts cost nothing.
    const recent = (speed: 'fast' | 'slow') => {
      const ids = [...byLeague.keys()].filter((id) => (speed === 'slow') === id.includes('-slow-'));
      ids.sort((a, b) => slotOf(b) - slotOf(a));
      return ids.slice(0, RECENT_SLOTS);
    };
    const candidateIds = [...recent('fast'), ...recent('slow')];
    if (candidateIds.length === 0) return json({ drafts: [] });

    // 3) Batch-read those league docs.
    const refs = candidateIds.map((id) => db.collection('drafts').doc(id));
    const leagueSnaps = await db.getAll(...refs);
    const docById = new Map<string, LeagueDoc>();
    for (const snap of leagueSnaps) {
      if (snap.exists) docById.set(snap.id, (snap.data() ?? {}) as LeagueDoc);
    }

    // 4) Classify. Full lobbies need a Go check to split drafting vs completed.
    const fullToVerify: string[] = [];
    const rows = new Map<string, { status: Status; players: number; maxPlayers: number; name: string }>();

    for (const id of candidateIds) {
      const l = docById.get(id);
      if (!l) continue; // 404 doc → treat as gone
      const numPlayers = typeof l.NumPlayers === 'number' ? l.NumPlayers : 0;
      const maxPlayers = typeof l.MaxPlayers === 'number' && l.MaxPlayers > 0 ? l.MaxPlayers : 10;
      const name = l.DisplayName ?? '';
      if (numPlayers < maxPlayers && l.IsLocked !== true) {
        rows.set(id, { status: 'filling', players: numPlayers, maxPlayers, name });
      } else {
        fullToVerify.push(id);
      }
    }

    const verdicts = await mapWithConcurrency(fullToVerify, GO_VERIFY_CONCURRENCY, goStatus);
    fullToVerify.forEach((id, idx) => {
      const v = verdicts[idx];
      const l = docById.get(id)!;
      const maxPlayers = typeof l.MaxPlayers === 'number' && l.MaxPlayers > 0 ? l.MaxPlayers : 10;
      const name = l.DisplayName ?? '';
      if (v === 'drafting') rows.set(id, { status: 'drafting', players: maxPlayers, maxPlayers, name });
      else if (v === 'filling') rows.set(id, { status: 'filling', players: maxPlayers, maxPlayers, name });
      // 'completed' / 'unknown' → omit (don't leak finished drafts).
    });

    const drafts = [...rows.entries()].map(([id, r]) => {
      const token = byLeague.get(id);
      const speed: 'fast' | 'slow' = id.includes('-slow-') ? 'slow' : 'fast';
      return {
        id,
        contestName: r.name,
        status: r.status,
        type: null,
        draftSpeed: speed,
        players: r.players,
        maxPlayers: r.maxPlayers,
        passType: String(token?.PassType ?? token?.passType ?? '').toLowerCase() === 'free' ? 'free' : 'paid',
        cardId: token?.CardId ?? token?._cardId ?? undefined,
      };
    });

    return json({ drafts });
  } catch (err) {
    logger.error('[owner/active-drafts] failed', { err: err instanceof Error ? err.message : String(err) });
    return json({ drafts: [] });
  }
}
