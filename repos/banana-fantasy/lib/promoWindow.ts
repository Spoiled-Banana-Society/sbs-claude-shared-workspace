/**
 * Week-long promo window (Boris 2026-07-21, Tue→Sun):
 *   until Sunday 2026-07-26 12:00 PM PT —
 *   (a) FREE drafts earn promo credit exactly like paid ones
 *       (participation checks stay — only the free/paid gate is lifted), and
 *   (b) Pick 9 joins Pick 10 as an always-on winning slot in the pick-slot promo.
 *
 * Everything keyed off this helper AUTO-REVERTS at the deadline — the
 * paid-only hard rule and the normal pick ladder come back without a deploy.
 * Shared by server (crediting) and client (copy) so behavior and display
 * can never disagree.
 *
 * ⚠️ The user-facing deadline is written into promo copy in several places
 * (lib/db-firestore.ts getPromos, components/modals/PromoModal.tsx). Move this
 * constant and those strings TOGETHER — a mismatch tells users the wrong cutoff.
 */
// NOON Sunday. Briefly set to end-of-Sunday earlier on 2026-07-25, then pulled
// back the same day (Boris: "switching it to tomorrow at 12pm PT"). Noon PDT
// (UTC-7) on Sun Jul 26 === Sun Jul 26 19:00 UTC.
export const PROMO_WEEKEND_END_MS = Date.UTC(2026, 6, 26, 19, 0, 0); // Sun Jul 26 2026, 12:00 PM PT

export function promoWeekendActive(now: number = Date.now()): boolean {
  return now < PROMO_WEEKEND_END_MS;
}
