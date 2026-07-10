// Pure, side-effect-free promo arithmetic.
//
// Kept out of db-firestore.ts so the grant / progress / gate rules are
// unit-testable without a live Firestore (mirrors lib/exposureUtils.ts,
// lib/slowDraftClock.ts). db-firestore imports these and does the I/O.

/** First-purchase bonus (new players only): every pass earns this many spins. */
export const FIRST_PURCHASE_SPINS_PER_PASS = 2;

/**
 * Wheel spins earned from a first paid purchase of `quantity` passes.
 * 1 → 2, 2 → 4, 4 → 8 … NO cap (was every-2-passes = 1 spin until
 * 2026-07-10). Non-positive / invalid → 0.
 */
export function firstPurchaseSpins(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.floor(quantity) * FIRST_PURCHASE_SPINS_PER_PASS;
}

export interface FirstPurchaseGrant {
  /** Whether the one-time bonus should be marked consumed. */
  consume: boolean;
  /** Spins to add to the first-purchase promo's claimCount. */
  spins: number;
}

/**
 * Decide the first-purchase outcome. NEW PLAYERS ONLY (Boris 2026-07-10):
 * a returning player from a previous season earns nothing AND does not
 * consume the bonus — so a specific returning user can still be granted it
 * later without extra state repair. For new players the bonus is ONE-TIME:
 * the first paid purchase defines it (every pass in that transaction = 2
 * spins), and a subsequent purchase grants nothing and must not re-consume.
 */
export function computeFirstPurchaseGrant(
  alreadyGranted: boolean,
  quantity: number,
  isReturning = false,
): FirstPurchaseGrant {
  if (isReturning || alreadyGranted) return { consume: false, spins: 0 };
  const spins = firstPurchaseSpins(quantity);
  return { consume: spins > 0, spins };
}

export interface FirstPurchaseUpsell {
  /** Spins this quantity earns right now (qty × 2). */
  spinsThisPurchase: number;
  /** How many MORE passes to reach the next spins (always 1 — every pass pays). */
  passesToNextSpin: number;
  /** Total quantity at which the next spins land (qty + 1). */
  nextSpinTotal: number;
}

/**
 * Drives the first-purchase mint-time nudge ("1 more pass = 2 more spins").
 * Pure so the message math is unit-tested. Every pass pays, so the next
 * spins are always exactly one pass away.
 */
export function firstPurchaseUpsell(quantity: number): FirstPurchaseUpsell {
  const q = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  return {
    spinsThisPurchase: q * FIRST_PURCHASE_SPINS_PER_PASS,
    passesToNextSpin: 1,
    nextSpinTotal: q + 1,
  };
}

/**
 * Whether a promo awards a Banana Wheel spin (used to decide where to show the
 * first-time "what's a spin?" explainer). Spin promos all say "SPIN" in their
 * title (e.g. "Buy 10 → FREE SPIN", "First Purchase → FREE SPINS").
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
 * multiple of `max` ROLLS OVER to 0 — the promo repeats, and a bar stuck at
 * 10/10 read as "done, can't earn again" (Boris 2026-07-01).
 */
export function computeMintProgress(current: number, max: number, quantity: number): MintProgress {
  const safeCurrent = current || 0;
  const newTotal = safeCurrent + quantity;
  // Milestones crossed by THIS purchase = the DELTA. Subtracting
  // Math.floor(safeCurrent / max) keeps the count correct even when `current`
  // was stored as `max` (the legacy full-bar display value from before the
  // rollover change). Without the subtraction, that stored `max` re-counted
  // the already-awarded milestone and handed out an EXTRA spin on the next
  // purchase (the "buy 10 sometimes gives an extra spin" bug).
  const milestonesEarned = Math.floor(newTotal / max) - Math.floor(safeCurrent / max);
  return { progressCurrent: newTotal % max, milestonesEarned };
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
