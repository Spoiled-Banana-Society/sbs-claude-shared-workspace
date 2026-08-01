/**
 * THE ELIMINATOR — rates and constants ONLY. No imports, no Node built-ins.
 *
 * ⚠️ This file exists so CLIENT components can read the rates. lib/eliminatorMath
 * imports `node:crypto` for the seeded burn selection, and webpack cannot bundle
 * a `node:` scheme for the browser — importing eliminatorMath from a 'use client'
 * component fails the build outright and 500s the whole /promos route (caught
 * 2026-07-31 before deploy). Anything the UI needs lives here; anything that
 * needs crypto stays in eliminatorMath.
 */

// ── Earning rates (Richard 2026-07-31) ──────────────────────────────────────
// ⚠️ BUYING A PASS EARNS NOTHING. Bananas come only from ENTERING drafts. With
// a purchase reward, someone could buy 30 passes at 8:45pm and instantly match a
// player who had survived six hours; entering 30 drafts takes hours of real
// attention, so time cannot be bought.
export const BANANAS_FREE_DRAFT = 1;
export const BANANAS_PAID_DRAFT = 2;

/** Awarded to every survivor at every burn. Flat and uncapped — hour 1 and hour
 *  12 are both worth 10, and it never stops. Six hours on the list is 60
 *  Bananas, while the platform's heaviest drafter enters ~18 drafts a day for
 *  36. Time beats volume. */
export const BANANAS_SURVIVE_HOUR = 10;

/** How many survive each burn. */
export const SURVIVORS_PER_BURN = 5;

/** Spins awarded to each finalist who doesn't take the JackHOF seat. */
export const SPINS_PER_RUNNER_UP = 2;

/** List opens (no burn fires at this hour — it's the join window). */
export const OPEN_HOUR_PT = 9;
/** Final burn. Whoever is standing after this one wins. */
export const FINAL_BURN_HOUR_PT = 21;

/**
 * Days that open LATE. A shortened night still finishes at 9pm, which covers
 * the platform's best hours — activity peaks 5–8pm PT — so a short day is a
 * strong day, not a weak one.
 *
 * 2026-07-31: first night opens 4pm PT (Richard). Burns at 5, 6, 7, 8 and 9pm —
 * five burns, and the 9pm one gives out the seat.
 */
export const SHORT_DAY_OPEN_HOUR_PT: Record<string, number> = {
  '2026-07-31': 16,
};
