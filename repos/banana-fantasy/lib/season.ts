/**
 * 2026 season clock — the single source of the current gameweek string
 * ("2026REG-01"). The Go API's /league/getGameweek still hardcodes the 2024
 * prefix, so the site derives the week here instead (Richard 2026-09-09:
 * scoring is ESPN-fed and run by us — see scripts/espn-scorer.mjs, which
 * carries the same week math).
 *
 * Week 1 opens Tue Sep 8 2026 3:00 AM PT and weeks roll every Tuesday at
 * 3:00 AM PT — last season's weekAdvance schedule. Client-safe, no Firestore.
 */
export const SEASON_YEAR = 2026;
export const REGULAR_SEASON_WEEKS = 18;
export const WEEK1_ROLLOVER_MS = Date.UTC(2026, 8, 8, 10, 0, 0); // Tue Sep 8 2026, 3:00 AM PDT
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function currentWeekNumber(now: number = Date.now()): number {
  const wk = 1 + Math.floor((now - WEEK1_ROLLOVER_MS) / WEEK_MS);
  return Math.min(REGULAR_SEASON_WEEKS, Math.max(1, wk));
}

export function gameweekString(week: number, year: number = SEASON_YEAR): string {
  return `${year}REG-${String(week).padStart(2, '0')}`;
}

export function currentGameweek(now: number = Date.now()): string {
  return gameweekString(currentWeekNumber(now));
}
