// Pure, side-effect-free promo arithmetic.
//
// Kept out of db-firestore.ts so the grant / progress / gate rules are
// unit-testable without a live Firestore (mirrors lib/exposureUtils.ts,
// lib/slowDraftClock.ts). db-firestore imports these and does the I/O.

/** First-purchase bonus: this many paid passes earns one wheel spin. */
export const FIRST_PURCHASE_PASSES_PER_SPIN = 4;

/**
 * Wheel spins earned from a first paid purchase of `quantity` passes.
 * 4 → 1, 8 → 2, 12 → 3 … floored, NO cap. Non-positive / invalid → 0.
 */
export function firstPurchaseSpins(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.floor(quantity / FIRST_PURCHASE_PASSES_PER_SPIN);
}

export interface FirstPurchaseGrant {
  /** Whether the one-time bonus should be marked consumed. */
  consume: boolean;
  /** Spins to add to the first-purchase promo's claimCount. */
  spins: number;
}

/**
 * Decide the first-purchase outcome. The bonus is ONE-TIME: the first paid
 * purchase defines it, regardless of size. A tiny first buy (qty < 4) still
 * consumes the bonus with 0 spins — you must buy it all in one transaction.
 * A subsequent purchase grants nothing and must not re-consume.
 */
export function computeFirstPurchaseGrant(
  alreadyGranted: boolean,
  quantity: number,
): FirstPurchaseGrant {
  if (alreadyGranted) return { consume: false, spins: 0 };
  return { consume: true, spins: firstPurchaseSpins(quantity) };
}

export interface FirstPurchaseUpsell {
  /** Spins this quantity earns right now (floor(qty / 4)). */
  spinsThisPurchase: number;
  /** How many MORE passes to reach the next spin (1..4). */
  passesToNextSpin: number;
  /** Total quantity at which the next spin lands (qty + passesToNextSpin). */
  nextSpinTotal: number;
}

/**
 * Drives the first-purchase mint-time nudge ("buy X more for a total of N to
 * earn a spin"). Pure so the message math is unit-tested. At a multiple of 4
 * the user just earned a spin and the next is a full 4 away.
 */
export function firstPurchaseUpsell(quantity: number): FirstPurchaseUpsell {
  const q = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  const spinsThisPurchase = Math.floor(q / FIRST_PURCHASE_PASSES_PER_SPIN);
  const remainder = q % FIRST_PURCHASE_PASSES_PER_SPIN;
  const passesToNextSpin =
    remainder === 0 ? FIRST_PURCHASE_PASSES_PER_SPIN : FIRST_PURCHASE_PASSES_PER_SPIN - remainder;
  return { spinsThisPurchase, passesToNextSpin, nextSpinTotal: q + passesToNextSpin };
}

/**
 * Whether a promo awards a Banana Wheel spin (used to decide where to show the
 * first-time "what's a spin?" explainer). Spin promos all say "SPIN" in their
 * title (e.g. "Buy 10 → FREE SPIN", "First Purchase → BONUS SPINS").
 */
export function promoAwardsSpin(title: string | undefined): boolean {
  return !!title && /spin/i.test(title);
}

export interface MintProgress {
  progressCurrent: number;
  milestonesEarned: number;
}

/**
 * Buy-10-style stacking progress. Extracted verbatim from the inline math in
 * _incrementMintPromosInTx so the "interconnection" behaviour (every purchase
 * advances the standing promos too) is covered by tests. Landing exactly on a
 * multiple of `max` shows a full bar (max) rather than 0.
 */
export function computeMintProgress(current: number, max: number, quantity: number): MintProgress {
  const newTotal = (current || 0) + quantity;
  const milestonesEarned = Math.floor(newTotal / max);
  const remainder = newTotal % max;
  const progressCurrent = milestonesEarned > 0 && remainder === 0 ? max : remainder;
  return { progressCurrent, milestonesEarned };
}

export interface FirstPurchaseDrainInput {
  /** Already made a first paid purchase — gate is closed forever. */
  firstPurchaseBonusGranted: boolean;
  /** Already pinged once — never fire twice. */
  firstPurchasePromoUnlocked: boolean;
  /** Genuine new-user funnel: they've spun the welcome wheel at least once. */
  hasSpunWheel: boolean;
  /** Remaining free draft passes in their balance. */
  freeDrafts: number;
  /** Remaining Jackpot entries won (from the wheel). */
  jackpotEntries: number;
  /** Remaining HOF entries won (from the wheel). */
  hofEntries: number;
  /** Remaining unspun wheel spins — each can yield more free/JP/HOF drafts. */
  wheelSpins: number;
  /** Any claimable promo still sitting there (Pick 10, referral, etc.) — the
   *  first-purchase promo itself is excluded by the caller. */
  hasPendingClaim: boolean;
  /** Any draft they entered that isn't finished yet (roster < 15). */
  hasDraftInProgress: boolean;
}

/**
 * New-user first-purchase ping gate — the SINGLE rule for when the popup +
 * cross-device notification fires. It fires only when the user is FULLY
 * DRAINED: every free / Jackpot / HOF draft finished, no unspun wheel spins,
 * no unclaimed promo waiting, and no draft still in progress — and only for a
 * genuine new user (spun the wheel) who hasn't purchased or been pinged yet.
 *
 * This is a STATE check (not a counter), so it automatically accounts for
 * drafts/spins granted by ANY promo added later (e.g. Pick 10) without needing
 * to special-case each grant site — the old counter only knew about the
 * welcome wheel, which let the ping fire while later-won free drafts remained.
 *
 * Callers MUST fail closed: if any signal (claims / in-progress drafts) can't
 * be read, treat the user as NOT drained and do not ping. Better a late ping
 * than an early one.
 */
export function shouldUnlockFirstPurchase(i: FirstPurchaseDrainInput): boolean {
  if (i.firstPurchaseBonusGranted || i.firstPurchasePromoUnlocked) return false;
  if (!i.hasSpunWheel) return false;
  if ((i.freeDrafts || 0) > 0) return false;
  if ((i.jackpotEntries || 0) > 0) return false;
  if ((i.hofEntries || 0) > 0) return false;
  if ((i.wheelSpins || 0) > 0) return false;
  if (i.hasPendingClaim) return false;
  if (i.hasDraftInProgress) return false;
  return true;
}
