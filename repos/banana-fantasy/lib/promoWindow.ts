/**
 * Week-long promo window (Boris 2026-07-21, Tue→Sun):
 *   until Sunday 2026-07-26 MIDNIGHT PT — i.e. the very end of Sunday, which
 *   is Monday 2026-07-27 07:00 UTC (PT is UTC-7 in July) —
 *   (a) FREE drafts earn promo credit exactly like paid ones
 *       (participation checks stay — only the free/paid gate is lifted), and
 *   (b) Pick 9 joins Pick 10 as an always-on winning slot in the pick-slot promo.
 *
 * Everything keyed off this helper AUTO-REVERTS at the deadline — the
 * paid-only hard rule and the normal pick ladder come back without a deploy.
 * Shared by server (crediting) and client (copy) so behavior and display
 * can never disagree.
 */
// End of SUNDAY (midnight), not Sunday noon — Boris 2026-07-25, extending the
// window by 12h so it matches "runs all the way through Sunday". Midnight at
// the end of Sun Jul 26 PT === Mon Jul 27 07:00 UTC.
export const PROMO_WEEKEND_END_MS = Date.UTC(2026, 6, 27, 7, 0, 0); // Sun Jul 26 2026, 11:59:59 PM PT

export function promoWeekendActive(now: number = Date.now()): boolean {
  return now < PROMO_WEEKEND_END_MS;
}
