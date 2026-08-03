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

/**
 * THE ELIMINATOR goes live at 4:00 PM PT on Jul 31 2026 (Richard).
 *
 * Every surface gates on this instant, so the promo reveals itself on the clock
 * with NO second deploy: the card is filtered out of promoFilter until then and
 * the /promos leaderboard banner renders nothing while the day's status is
 * still 'pending'. Shipping the code early is therefore safe — it simply isn't
 * visible until the launch moment.
 *
 * ⚠️ This must equal the day's open hour in lib/eliminatorRates
 * (SHORT_DAY_OPEN_HOUR_PT['2026-07-31'] = 16). If the two ever disagree, the
 * card appears before the list accepts anyone, or the list opens to an
 * invisible promo.
 */
export const ELIMINATOR_LAUNCH_MS = Date.UTC(2026, 6, 31, 23, 0, 0); // Jul 31 2026, 4:00 PM PT

/**
 * THE ELIMINATOR RETIRES with the 9pm PT final burn on Aug 1 2026 (Richard:
 * "at 9pm after you show the winner of everything we're gonna remove the promo").
 *
 * ⚠️ THIS CUTOFF IS ALREADY IN THE PAST WHEN THE CODE SHIPS — that is deliberate.
 * The retirement is DEPLOY-TRIGGERED, not clock-triggered, because the winner
 * reveal is a SECOND beat REVEAL_DELAY_MS (5 min) after the final burn, and the
 * reveal is normally fired by a tick from the board itself. A clock gate set to
 * 9:00 sharp would hide the board out from under the reveal it still has to run —
 * and 7/31's final burn already came in 22 minutes late once. So: confirm the
 * JackHOF winner is on the board, THEN deploy. The constant records when the
 * promo ended; the deploy is what enforces it.
 *
 * At this instant the promo is gone in every direction:
 *   • the card leaves every surface (eliminatorLive below → promoFilter),
 *   • no new day ever opens (ensureDay),
 *   • filled drafts stop earning Bananas (creditBananas),
 *   • no further burns fire (crons/eliminator + promos/eliminator/tick).
 * A PENDING REVEAL IS DELIBERATELY EXEMPT — runDueReveal keeps running so a
 * final five can never be stranded un-paid by the retirement itself.
 *
 * Day docs, player docs and every per-user Banana ledger row are KEPT FOREVER
 * (same as the Banana Draw's) — the burn history stays auditable.
 */
export const ELIMINATOR_END_MS = Date.UTC(2026, 7, 2, 4, 0, 0); // Aug 1 2026, 9:00 PM PT

export function eliminatorLive(now: number = Date.now()): boolean {
  return now >= ELIMINATOR_LAUNCH_MS && now < ELIMINATOR_END_MS;
}

/** True once the promo has retired. Server paths gate on this so a retired
 *  promo cannot quietly keep opening days and paying Bananas off-surface. */
export function eliminatorRetired(now: number = Date.now()): boolean {
  return now >= ELIMINATOR_END_MS;
}
