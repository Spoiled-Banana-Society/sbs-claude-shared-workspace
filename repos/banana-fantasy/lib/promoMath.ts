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

export interface CompletionGateInput {
  /** True when the just-finished draft was entered with a free (wheel-won) pass. */
  usedFreePass: boolean;
  pendingWheelWinnings: number;
  firstPurchaseBonusGranted: boolean;
  firstPurchasePromoUnlocked: boolean;
}

export interface CompletionGateResult {
  /** New pending-winnings value to persist. */
  pendingWheelWinnings: number;
  /** True when this completion should unlock the new-user popup + notification. */
  unlock: boolean;
}

/**
 * New-user popup gate. Only FREE (wheel-won) draft completions count down
 * `pendingWheelWinnings`; the popup unlocks exactly when the LAST won draft
 * finishes (count reaches 0). Never unlocks for a user who never won, who
 * already purchased, or who already unlocked — so it fires at most once and
 * never prematurely (entering all drafts drops the balance, but only
 * *completing* them decrements this counter).
 */
export function applyCompletionGate(input: CompletionGateInput): CompletionGateResult {
  const before = Math.max(0, input.pendingWheelWinnings || 0);
  if (!input.usedFreePass) {
    return { pendingWheelWinnings: before, unlock: false };
  }
  const after = Math.max(0, before - 1);
  const unlock =
    before > 0 &&
    after === 0 &&
    !input.firstPurchaseBonusGranted &&
    !input.firstPurchasePromoUnlocked;
  return { pendingWheelWinnings: after, unlock };
}
