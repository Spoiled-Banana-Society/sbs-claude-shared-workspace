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

/**
 * "Buy 10 → FREE SPIN" (the `mint` promo) RETIRES at midnight PT, July 28
 * (Boris, 2026-07-27 ~11:20pm — same-night order). At this instant:
 *   • the card disappears from every surface (promoFilter gates on this),
 *   • purchases stop advancing the bar / earning milestones
 *     (_incrementMintPromosInTx gates on this),
 *   • claiming is closed (claimPromo gates on this) — outstanding unclaimed
 *     spins are auto-credited to wheels by the cutover job instead, and the
 *     full progress state of every user is snapshotted to
 *     `mint_promo_final_snapshot` as grandfathering proof ("I was at 2/10").
 */
export const MINT_PROMO_END_MS = Date.UTC(2026, 6, 28, 7, 0, 0); // Jul 28 2026, 12:00 AM PT

/** Banana Draw's final draw fires at noon PT Jul 31 (5th and last seat).
 *  After this instant the promo card retires; cycle docs and per-user Banana
 *  ledgers are kept forever. */
export const BANANA_DRAW_END_MS = Date.UTC(2026, 6, 31, 19, 0, 0); // Jul 31 2026, 12:00 PM PT
