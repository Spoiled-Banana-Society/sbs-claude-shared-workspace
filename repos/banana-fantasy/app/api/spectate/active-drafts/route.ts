import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
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

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

    const db = getAdminFirestore();
    const trackerSnap = await db.collection('drafts').doc('draftTracker').get();
    const filled = Number(
      (trackerSnap.data() as { FilledLeaguesCount?: number } | undefined)?.FilledLeaguesCount ?? 0,
    );
    // NOTE: do NOT early-return when filled<=0. After a clean-slate reset the
    // very first draft is slot 0 and can be FILLING before anything completes —
    // that's exactly a case we must still surface.

    // Draft doc IDs look like "{year}-{fast|slow}-draft-{N}". A naive lookup
    // misses the filling draft for two reasons, so we mirror the proven
    // proof-feed route here instead of guessing:
    //   1. The year prefix can't be derived from the calendar OR from an
    //      orderBy('__name__') query (that needs a descending index the DB
    //      doesn't have, so it silently fails) — try the last few season years.
    //   2. The `draft-N` is a PER-SPEED slot counter that drifts from the global
    //      FilledLeaguesCount (fast/slow have separate counters; special drafts
    //      push it ahead) — scan a buffer ABOVE and below `filled`, not `+1`.
    const currentYear = new Date().getUTCFullYear();
    const yearPrefixes = [currentYear, currentYear - 1, currentYear - 2].map(String);
    const apiBase = getServerDraftsApiUrl();

    const SLOT_AHEAD = 15;
    const candidates: { id: string; speed: 'fast' | 'slow'; num: number }[] = [];
    for (const speed of SPEEDS) {
      // FAST drafts cluster around the high FilledLeaguesCount, so a window
      // around `filled` catches the recent ones cheaply. SLOW (and wheel/special)
      // drafts use their OWN low counters and live at small slot numbers (0,1,2,3…),
      // so they must be probed from slot 0 — otherwise a growing FilledLeaguesCount
      // pushes the floor (`filled - PROBE_DEPTH`) above them and they vanish from
      // Spectate (exactly what happened: slow slots 0/1 dropped off once
      // FilledLeaguesCount passed 30). Slow drafts are sparse, so probing from 0 is
      // cheap. Admin-display only — no draft logic / user impact.
      const floor = speed === 'slow' ? 0 : Math.max(0, filled - PROBE_DEPTH);
      for (let num = filled + SLOT_AHEAD; num >= floor; num--) {
        for (const year of yearPrefixes) {
          candidates.push({ id: `${year}-${speed}-draft-${num}`, speed, num });
        }
      }
    }

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

    type Categorized = ActiveDraft & { completed: boolean };
    const drafts: Categorized[] = existing
      .map(({ c, snap }, i): Categorized | null => {
        const info = infoResults[i];
        const data = snap.data() as {
              Level?: string;
              DisplayName?: string;
              NumPlayers?: number; numPlayers?: number;
              MaxPlayers?: number; maxPlayers?: number;
              // Firestore stores Go field names (capitalized); accept the
              // json-tag variant too in case any doc was written differently.
              CurrentUsers?: Array<{ OwnerId?: string; ownerId?: string }>;
              currentUsers?: Array<{ OwnerId?: string; ownerId?: string }>;
            } | undefined;
        const rawMembers = data?.CurrentUsers ?? data?.currentUsers ?? [];
        const members = Array.isArray(rawMembers)
          ? rawMembers.map(u => (u?.OwnerId ?? u?.ownerId ?? '')).filter(Boolean)
          : [];
        const maxPlayers = Number(data?.MaxPlayers ?? data?.maxPlayers ?? 10) || 10;
        const numPlayers = Number(data?.NumPlayers ?? data?.numPlayers ?? members.length) || members.length;
        const pickNumber = info?.pickNumber ?? 0;
        // Completed signal: pickNumber has reached 150 AND there's no
        // active pick in flight (currentPickEndTime null/missing). Matches
        // what the Go API exposes for finished drafts (verified on
        // 2024-fast-draft-709 — pickNumber=150 + currentPickEndTime=null).
        const completed = pickNumber >= 150 && !info?.currentPickEndTime;
        return {
          draftId: c.id,
          displayName: info?.displayName ?? data?.DisplayName ?? c.id,
          speed: c.speed,
          level: data?.Level ?? null,
          pickNumber,
          currentDrafter: info?.currentDrafter ?? '',
          filling: !info,
          completed,
          numPlayers,
          maxPlayers,
          members,
          draftStartTime: Number(info?.draftStartTime ?? 0) || 0,
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
    const active = drafts
      // A `filling` draft only counts as active once at least one person has
      // joined — an empty 0/10 doc is a leftover lobby (e.g. someone joined
      // then left; the doc persists) and shouldn't clutter Spectate. Drafts
      // that have started drafting (pickNumber>0) always have members, so they
      // show regardless. Admin-display only — no user/draft-logic impact.
      .filter(d => !d.completed && ((d.filling && d.numPlayers > 0) || (d.pickNumber > 0 && d.pickNumber <= 150)))
      .sort(sortNewestFirst)
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
