import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminDatabase, getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

// GET /api/spectate/active-drafts
//
// Admin-gated. Returns the most recent in-progress drafts so the
// /admin Spectate tab can list them. Strategy:
// 1. Read drafts/draftTracker.FilledLeaguesCount as the high-water mark.
// 2. Probe the latest 30 fast + 30 slow draft IDs in parallel via the
//    Go API state/info endpoint (server-side URL, never PROD).
// 3. Keep drafts where 1 <= pickNumber <= 150 (drafting). Anything that
//    404s is either a future fill slot or pre-state-init filling — we
//    flag those as filling=true if a Firestore doc exists for the id.
// 4. Sort newest first.

const PROBE_DEPTH = 30;
const SPEEDS = ['fast', 'slow'] as const;

interface ActiveDraft {
  draftId: string;
  displayName: string;
  speed: 'fast' | 'slow';
  level: string | null;
  pickNumber: number;
  currentDrafter: string;
  filling: boolean;
  /** How many seats are taken right now (X of maxPlayers). */
  numPlayers: number;
  maxPlayers: number;
  /** Wallets of everyone who has joined so far (for the spectate "who's in" band). */
  members: string[];
  /** When the draft started (Unix seconds). 0 if unknown. Used to sort newest-first. */
  draftStartTime: number;
  /** When the current pick's clock expires (Unix seconds). 0 if unknown. */
  pickEndTime: number;
  /** Wallet next on the clock after the current pick. Empty if unknown. */
  onDeck: string;
}

interface DraftInfoResponse {
  pickNumber: number;
  currentDrafter: string;
  displayName: string;
  currentPickEndTime?: number | null;
  draftStartTime?: number | null;
}

// Hardcoded staging — see comment in /api/spectate/draft-state/route.ts.
const STAGING_DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

function getServerDraftsApiUrl(): string {
  return (process.env.STAGING_DRAFTS_API_URL || STAGING_DRAFTS_API_URL).replace(/\/$/, '');
}

// null = the draft genuinely has no state yet (404 → still filling).
// 'error' = the Go API failed (5xx/network) — the caller must NOT read that
// as "filling": a transient 500 here made completed drafts render as 10/10
// filling lobbies on the admin Spectate tab (2026-09-01). One retry, then
// fall back to the RTDB completion flag.
async function fetchJson<T>(url: string): Promise<T | null | 'error'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
    } catch { /* retry below */ }
  }
  return 'error';
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const apiBase = getServerDraftsApiUrl();

    // ⚠️ ENUMERATE the real draft doc IDs. Do NOT reconstruct them.
    //
    // This route used to rebuild "{year}-{speed}-draft-{N}" and probe a window
    // around draftTracker.FilledLeaguesCount. That window is a trap, and it
    // sprang twice:
    //   • the YEAR can't be derived from the calendar (season years lag, and an
    //     orderBy('__name__') lookup needs a descending index the DB lacks, so
    //     it silently threw and fell back to a hardcoded year);
    //   • `draft-N` is a PER-SPEED slot counter while FilledLeaguesCount is
    //     GLOBAL, so the two drift apart by however many slow + special drafts
    //     have run. On 2026-08-01 global was 394 while the live fast draft sat
    //     at slot 363 — a gap of 31 against a probe depth of 30. The running
    //     draft fell one slot below the floor and Spectate showed nothing.
    // Any fixed depth is just a countdown to the next time that drift wins.
    //
    // listDocuments() returns document NAMES only — no document reads — so
    // enumerating the collection is cheap and, unlike the probe, cannot drift.
    const refs = await db.collection('drafts').listDocuments();
    const parsed = refs
      .map((r) => /^(\d{4})-(fast|slow)-draft-(\d+)$/.exec(r.id))
      .filter((mm): mm is RegExpExecArray => mm !== null)
      .map((mm) => ({ id: mm[0], speed: mm[2] as 'fast' | 'slow', num: Number(mm[3]) }));

    // Highest slot first, per speed — anything in progress is at the top. Slow
    // and fast keep separate counters, so they're ranked separately rather than
    // against each other.
    const windowCandidates = SPEEDS.flatMap((speed) => parsed
      .filter((p) => p.speed === speed)
      .sort((a, b) => b.num - a.num)
      .slice(0, PROBE_DEPTH));

    // ⚠️ ALSO query every FILLING draft directly (NumPlayers 1-9), regardless
    // of slot number. The recent-slot window alone went blind 9/4 when one
    // lucky wheel winner (43 passes in a day) solo-opened 41 consecutive fast
    // lobbies — the genuinely-filling lobby with the most players fell below
    // the window and Boris couldn't see it to bot-fill. ~50 extra doc reads
    // per poll, admin-only surface.
    const fillingSnap = await db.collection('drafts')
      .where('NumPlayers', '>=', 1).where('NumPlayers', '<=', 9)
      .get().catch(() => null);
    const windowIds = new Set(windowCandidates.map((c) => c.id));
    const fillingExtra = (fillingSnap?.docs ?? [])
      .map((d) => /^(\d{4})-(fast|slow)-draft-(\d+)$/.exec(d.id))
      .filter((mm): mm is RegExpExecArray => mm !== null)
      .map((mm) => ({ id: mm[0], speed: mm[2] as 'fast' | 'slow', num: Number(mm[3]) }))
      .filter((c) => !windowIds.has(c.id));
    const candidates = [...windowCandidates, ...fillingExtra];

    // Step 1 — read every candidate doc (cheap, batched). The vast majority of
    // candidate IDs (wrong year / non-existent slot) simply don't exist; only
    // real drafts survive. This is the source for Level / DisplayName / members.
    const docSnaps = await Promise.all(
      candidates.map(c => db.collection('drafts').doc(c.id).get().catch(() => null)),
    );
    const existing: { c: { id: string; speed: 'fast' | 'slow'; num: number }; snap: NonNullable<(typeof docSnaps)[number]> }[] = [];
    candidates.forEach((c, i) => {
      const snap = docSnaps[i];
      if (snap?.exists) existing.push({ c, snap });
    });

    // Step 2 — only for docs that REALLY exist, ask the Go API whether they're
    // mid-draft (pickNumber / currentDrafter). A filling draft 404s here (state
    // isn't created until it starts) — that 404 is exactly our filling signal.
    const infoResults = await Promise.all(
      existing.map(x => fetchJson<DraftInfoResponse>(`${apiBase}/draft/${encodeURIComponent(x.c.id)}/state/info`)),
    );

    // Step 2.5 — the pick CLOCK and on-deck drafter live only in RTDB
    // (realTimeDraftInfo); the Go info endpoint doesn't expose them. Read the
    // node just for drafts that are actually mid-draft (info != null) so the
    // Spectate tab can show who's on the clock, time remaining, and who's up
    // next. Best-effort: a failed read only costs the clock display.
    const rtdb = getAdminDatabase();
    const clockResults = await Promise.all(
      existing.map(async (x, i) => {
        if (!infoResults[i]) return null;
        try {
          const snap = await rtdb.ref(`drafts/${x.c.id}/realTimeDraftInfo`).get();
          const v = snap.val() as { pickEndTime?: number; onDeckDrafter?: string; isDraftComplete?: boolean; pickNumber?: number } | null;
          return v
            ? {
                pickEndTime: Number(v.pickEndTime ?? 0) || 0,
                onDeck: String(v.onDeckDrafter ?? ''),
                rtComplete: v.isDraftComplete === true,
                rtPickNumber: Number(v.pickNumber ?? 0) || 0,
              }
            : null;
        } catch {
          return null;
        }
      }),
    );

    type Categorized = ActiveDraft & { completed: boolean };
    const drafts: Categorized[] = existing
      .map(({ c, snap }, i): Categorized | null => {
        const infoRaw = infoResults[i];
        // Go API failed (not a 404): don't read that as "filling" — fall back
        // to RTDB. A completed draft has isDraftComplete=true there; a truly
        // filling lobby has no realTimeDraftInfo node at all.
        const goFailed = infoRaw === 'error';
        const info = infoRaw === 'error' ? null : infoRaw;
        const data = snap.data() as {
              Level?: string;
              DisplayName?: string;
              NumPlayers?: number; numPlayers?: number;
              MaxPlayers?: number; maxPlayers?: number;
              // Firestore stores Go field names (capitalized); accept the
              // json-tag variant too in case any doc was written differently.
              CurrentUsers?: Array<{ OwnerId?: string; ownerId?: string }>;
              currentUsers?: Array<{ OwnerId?: string; ownerId?: string }>;
              PrivateLeagueId?: string;
            } | undefined;
        // Password-gated private-league drafts never appear on the public
        // Spectate tab (Richard 2026-08-10).
        if (data?.PrivateLeagueId) return null;
        const rawMembers = data?.CurrentUsers ?? data?.currentUsers ?? [];
        const members = Array.isArray(rawMembers)
          ? rawMembers.map(u => (u?.OwnerId ?? u?.ownerId ?? '')).filter(Boolean)
          : [];
        const maxPlayers = Number(data?.MaxPlayers ?? data?.maxPlayers ?? 10) || 10;
        const numPlayers = Number(data?.NumPlayers ?? data?.numPlayers ?? members.length) || members.length;
        const clock = clockResults[i];
        const pickNumber = info?.pickNumber ?? (goFailed ? clock?.rtPickNumber ?? 0 : 0);
        // Completed signal: pickNumber has reached 150 AND there's no
        // active pick in flight (currentPickEndTime null/missing). Matches
        // what the Go API exposes for finished drafts (verified on
        // 2024-fast-draft-709 — pickNumber=150 + currentPickEndTime=null).
        const completed = goFailed
          ? clock?.rtComplete === true
          : pickNumber >= 150 && !info?.currentPickEndTime;
        return {
          draftId: c.id,
          displayName: info?.displayName ?? data?.DisplayName ?? c.id,
          speed: c.speed,
          level: data?.Level ?? null,
          pickNumber,
          currentDrafter: info?.currentDrafter ?? '',
          filling: goFailed ? !clock : !info,
          completed,
          numPlayers,
          maxPlayers,
          members,
          draftStartTime: Number(info?.draftStartTime ?? 0) || 0,
          pickEndTime: clockResults[i]?.pickEndTime ?? 0,
          onDeck: clockResults[i]?.onDeck ?? '',
        };
      })
      .filter((d): d is Categorized => d !== null);

    // Newest-first by the actual draft start time. Fall back to the numeric
    // slot in the draftId (parsed as a number — NOT a string compare, which
    // wrongly puts "...-9" above "...-25") when a start time is missing.
    const slotNum = (id: string): number => {
      const m = id.match(/-(\d+)$/);
      return m ? Number(m[1]) : 0;
    };
    const sortNewestFirst = (a: Categorized, b: Categorized) => {
      if (b.draftStartTime !== a.draftStartTime) return b.draftStartTime - a.draftStartTime;
      return slotNum(b.draftId) - slotNum(a.draftId);
    };
    // FILLING drafts sort by seats DESC (closest to filling on top — that's
    // what Boris bot-fills, 9/4), ties by newest slot; in-progress drafts keep
    // newest-first and rank below the filling group.
    const sortFillingFirst = (a: Categorized, b: Categorized) => {
      const aFill = a.filling && a.pickNumber === 0 ? 1 : 0;
      const bFill = b.filling && b.pickNumber === 0 ? 1 : 0;
      if (aFill !== bFill) return bFill - aFill;
      if (aFill && bFill && b.numPlayers !== a.numPlayers) return b.numPlayers - a.numPlayers;
      return sortNewestFirst(a, b);
    };
    const active = drafts
      // A `filling` draft only counts as active once at least one person has
      // joined — an empty 0/10 doc is a leftover lobby (e.g. someone joined
      // then left; the doc persists) and shouldn't clutter Spectate. Drafts
      // that have started drafting (pickNumber>0) always have members, so they
      // show regardless. Admin-display only — no user/draft-logic impact.
      .filter(d => !d.completed && ((d.filling && d.numPlayers > 0) || (d.pickNumber > 0 && d.pickNumber <= 150)))
      .sort(sortFillingFirst)
      .map(({ completed: _c, ...rest }) => rest);
    const completed = drafts
      .filter(d => d.completed)
      .sort(sortNewestFirst)
      .map(({ completed: _c, ...rest }) => rest);

    return json({ drafts: active, active, completed }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('spectate.active_drafts.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
