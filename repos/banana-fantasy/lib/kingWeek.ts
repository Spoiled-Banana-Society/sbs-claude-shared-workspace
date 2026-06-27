/**
 * King of Drafts week window — single source of truth (Boris 2026-06-10):
 *
 *   Week runs Monday 5:00 AM PT → Sunday 11:00 PM PT.
 *   After Sunday 11 PM PT the week is closed; the winner is crowned and
 *   wears the King badge for the following week. Drafts filled in the gap
 *   (Sun 11 PM → Mon 5 AM PT) don't count toward any week.
 *
 * Stored in UTC (PDT): start = Monday 12:00 UTC, close = Monday 06:00 UTC.
 * Used by the live leaderboard route AND the weekly crowning cron so what
 * users watch is exactly what decides the badge.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const KING_WEEK_START_UTC_HOUR = 12; // Monday 5am PT (PDT)
export const KING_WEEK_CLOSE_UTC_HOUR = 6; // Monday 06:00 UTC = Sunday 11pm PT

export interface KingWeek {
  startIso: string;
  endIso: string;
}

/**
 * The week currently being competed. During the Sun 11pm → Mon 5am PT gap
 * (after a close, before the next start) this returns the UPCOMING week —
 * zero counts, countdown to its close — so the panel never shows a stale
 * finished race.
 */
export function currentKingWeek(nowMs: number): KingWeek {
  const d = new Date(nowMs);
  let daysSinceMonday = (d.getUTCDay() + 6) % 7;
  if (daysSinceMonday === 0 && d.getUTCHours() < KING_WEEK_START_UTC_HOUR) daysSinceMonday = 7;
  let start = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday,
    KING_WEEK_START_UTC_HOUR, 0, 0,
  );
  // Close = following Monday 06:00 UTC (start + 7d − 6h).
  let end = start + 7 * DAY_MS - (KING_WEEK_START_UTC_HOUR - KING_WEEK_CLOSE_UTC_HOUR) * HOUR_MS;
  if (nowMs >= end) {
    start += 7 * DAY_MS;
    end += 7 * DAY_MS;
  }
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

/** The most recently CLOSED week — what the Monday-06:00-UTC cron crowns. */
export function lastClosedKingWeek(nowMs: number): KingWeek {
  const cur = currentKingWeek(nowMs);
  return {
    startIso: new Date(new Date(cur.startIso).getTime() - 7 * DAY_MS).toISOString(),
    endIso: new Date(new Date(cur.endIso).getTime() - 7 * DAY_MS).toISOString(),
  };
}

// ── Shared tally + tiebreaker (Boris 2026-06-27) ──────────────────────────
// One source of truth for counting + ranking King contenders, so the live
// leaderboard ("who's in first") and the weekly crowning cron can never
// disagree on a tie.

export interface KingTally {
  count: number;       // filled PAID drafts this week
  reachedAt: string;   // ISO timestamp of their LATEST counting draft = when
                       // they reached their current count (tiebreaker #2)
  firstAt: string;     // ISO timestamp of their EARLIEST counting draft = how
                       // long they've been grinding (tiebreaker #3)
  lastDraftId: string; // the draft that brought them to their count — used by
                       // the final lobby-join-order tiebreaker (#4)
}

interface KingEventDoc {
  data(): { type?: string; userId?: string; createdAtIso?: string; metadata?: { passType?: string; draftId?: string } };
}

/**
 * Resolves a draft's lobby-join order: draftId → (wallet → seat index, where
 * 0 = joined first). Built from the draft doc's `CurrentUsers` array, which the
 * Go API appends in join order. Supplied by the caller (reads Firestore) so this
 * module stays free of DB deps. Only ever called when there's an actual tie.
 */
export type RosterFetcher = (draftIds: string[]) => Promise<Map<string, Map<string, number>>>;

/**
 * Tally FILLED PAID drafts per wallet from activity-event docs. Counts only
 * `draft_filled` events with `passType: 'paid'`, before the week's close, and
 * excludes bots. Tracks reachedAt (latest counting draft), firstAt (earliest),
 * and lastDraftId (the draft at reachedAt).
 */
export function tallyKingDrafts(docs: KingEventDoc[], weekEndIso: string): Map<string, KingTally> {
  const out = new Map<string, KingTally>();
  for (const doc of docs) {
    const e = doc.data();
    if (e.type !== 'draft_filled') continue;        // FILLED paid drafts only — not entries
    if (e.metadata?.passType !== 'paid') continue;  // free drafts don't count
    const ts = e.createdAtIso ?? '';
    if (ts >= weekEndIso) continue;                 // after the week's close
    const wallet = (e.userId || '').toLowerCase();
    if (!wallet || wallet.startsWith('bot-')) continue;
    const draftId = e.metadata?.draftId ?? '';
    const cur = out.get(wallet);
    if (cur) {
      cur.count += 1;
      if (ts > cur.reachedAt) { cur.reachedAt = ts; cur.lastDraftId = draftId; } // latest draft = when they hit their count
      if (ts < cur.firstAt) cur.firstAt = ts;                                    // earliest draft = how long they've grinded
    } else {
      out.set(wallet, { count: 1, reachedAt: ts, firstAt: ts, lastDraftId: draftId });
    }
  }
  return out;
}

/**
 * Pure comparator for the first three rules: most paid drafts → reached the
 * count earliest → been grinding longest. Returns 0 when those tie; rule #4
 * (lobby-join order) is resolved by rankKingContenders below. No wallet-based
 * tiebreaker, ever (Boris 2026-06-27) — the winner is never decided by a wallet
 * address.
 */
export function compareKing(a: [string, KingTally], b: [string, KingTally]): number {
  if (b[1].count !== a[1].count) return b[1].count - a[1].count;                          // 1. count desc
  if (a[1].reachedAt !== b[1].reachedAt) return a[1].reachedAt < b[1].reachedAt ? -1 : 1; // 2. reached count first
  if (a[1].firstAt !== b[1].firstAt) return a[1].firstAt < b[1].firstAt ? -1 : 1;         // 3. grinding longest
  return 0;
}

/**
 * Full King ranking with all four rules. Sorts by compareKing (rules 1–3), then
 * — ONLY for entries that still tie — breaks them by rule #4: who joined the
 * final draft's lobby first (lowest CurrentUsers seat index). This guarantees a
 * single, fair, deterministic order with no wallet involved and no possible tie.
 * Roster reads happen only when a real tie exists, so the common path is free.
 */
export async function rankKingContenders(
  tally: Map<string, KingTally>,
  fetchRosters: RosterFetcher,
): Promise<[string, KingTally][]> {
  const sorted = [...tally.entries()].sort(compareKing);

  // Find adjacent tie-groups (compareKing === 0).
  const groups: Array<[number, number]> = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && compareKing(sorted[i], sorted[j]) === 0) j++;
    if (j - i > 1) groups.push([i, j]);
    i = j;
  }
  if (groups.length === 0) return sorted; // no ties → no roster reads

  const ids = new Set<string>();
  for (const [s, e] of groups) for (let k = s; k < e; k++) {
    if (sorted[k][1].lastDraftId) ids.add(sorted[k][1].lastDraftId);
  }
  const rosters = await fetchRosters([...ids]);
  const seat = (wallet: string, draftId: string): number =>
    rosters.get(draftId)?.get(wallet) ?? Number.MAX_SAFE_INTEGER;

  for (const [s, e] of groups) {
    const re = sorted.slice(s, e).sort((a, b) => {
      const ia = seat(a[0], a[1].lastDraftId);
      const ib = seat(b[0], b[1].lastDraftId);
      if (ia !== ib) return ia - ib;                                   // joined the lobby first
      // Only reachable if two people share a seat index across different
      // drafts (astronomically rare) — order by draftId so it's still
      // deterministic, never by wallet.
      return a[1].lastDraftId < b[1].lastDraftId ? -1 : a[1].lastDraftId > b[1].lastDraftId ? 1 : 0;
    });
    for (let k = 0; k < re.length; k++) sorted[s + k] = re[k];
  }
  return sorted;
}
