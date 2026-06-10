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
