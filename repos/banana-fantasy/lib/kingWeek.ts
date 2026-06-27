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
  count: number;      // filled PAID drafts this week
  reachedAt: string;  // ISO timestamp of their LATEST counting draft = when
                      // they reached their current count (1st tiebreaker)
  firstAt: string;    // ISO timestamp of their EARLIEST counting draft = how
                      // long they've been grinding (2nd tiebreaker, used when
                      // two people reach the count in the SAME draft/instant)
}

interface KingEventDoc {
  data(): { type?: string; userId?: string; createdAtIso?: string; metadata?: { passType?: string } };
}

/**
 * Tally FILLED PAID drafts per wallet from activity-event docs. Counts only
 * `draft_filled` events with `passType: 'paid'`, before the week's close, and
 * excludes bots. `reachedAt` tracks the timestamp of the wallet's LATEST
 * counting draft — i.e. WHEN they hit their current total.
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
    const cur = out.get(wallet);
    if (cur) {
      cur.count += 1;
      if (ts > cur.reachedAt) cur.reachedAt = ts;  // latest draft = when they hit their count
      if (ts < cur.firstAt) cur.firstAt = ts;      // earliest draft = how long they've grinded
    } else {
      out.set(wallet, { count: 1, reachedAt: ts, firstAt: ts });
    }
  }
  return out;
}

/**
 * King ranking comparator for `[wallet, KingTally]` entries. Tiebreak order:
 *   1. Most paid drafts (count desc).
 *   2. Reached that count EARLIEST — earliest last-counting-draft ("first to
 *      the number wins").
 *   3. If they hit it in the SAME draft/instant: who's been grinding longest —
 *      EARLIEST first counting draft.
 * No wallet-based tiebreaker by design (Boris 2026-06-27): the winner is never
 * decided by something arbitrary like a wallet address. Each draft_filled event
 * is written with its own millisecond timestamp, so #2/#3 separate real
 * contenders in practice; a perfect dead heat (identical count + same first AND
 * last instant) is left tied rather than broken by wallet.
 */
export function compareKing(a: [string, KingTally], b: [string, KingTally]): number {
  if (b[1].count !== a[1].count) return b[1].count - a[1].count;                          // count desc
  if (a[1].reachedAt !== b[1].reachedAt) return a[1].reachedAt < b[1].reachedAt ? -1 : 1; // reached count first
  if (a[1].firstAt !== b[1].firstAt) return a[1].firstAt < b[1].firstAt ? -1 : 1;         // grinding longest
  return 0;                                                                               // perfect dead heat — never broken by wallet
}
