// Pure, side-effect-free promo arithmetic.
//
// Kept out of db-firestore.ts so the grant / progress / gate rules are
// unit-testable without a live Firestore (mirrors lib/exposureUtils.ts,
// lib/slowDraftClock.ts). db-firestore imports these and does the I/O.

/** First-purchase bonus for NEW players: every pass earns this many spins. */
export const FIRST_PURCHASE_SPINS_PER_PASS = 2;

/** Classic first-purchase rate, kept for RETURNING players: passes per spin. */
export const FIRST_PURCHASE_CLASSIC_PASSES_PER_SPIN = 2;

/**
 * NEW-player wheel spins earned from a first paid purchase of `quantity`
 * passes. 1 → 2, 2 → 4, 4 → 8 … NO cap (new players upgraded from the
 * classic rate on 2026-07-10). Non-positive / invalid → 0.
 */
export function firstPurchaseSpins(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.floor(quantity) * FIRST_PURCHASE_SPINS_PER_PASS;
}

/**
 * RETURNING-player (classic) first-purchase spins: every 2 passes = 1 spin,
 * floored — 2 → 1, 4 → 2, 6 → 3 … NO cap. Unchanged from the pre-2026-07-10
 * promo (Boris: keep it as it was for returning players).
 */
export function classicFirstPurchaseSpins(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.floor(quantity / FIRST_PURCHASE_CLASSIC_PASSES_PER_SPIN);
}

export interface DepositBudgetGrant {
  /** Spins to credit for THIS purchase. */
  spins: number;
  /** Passes of the budget consumed by this purchase. */
  passesUsed: number;
  /** True when the budget is now fully consumed → mark the bonus granted. */
  exhausted: boolean;
}

/**
 * Deposit-budget first-purchase grant (NEW players who DEPOSITED first).
 * Their first deposit sets a pass budget (deposit ÷ $25) and EVERY pass they
 * subsequently buy earns FIRST_PURCHASE_SPINS_PER_PASS spins until the budget
 * is used up — so the deposit-time bell ("your $50 → 4 Free Spins") is always
 * exactly honored even when they enter drafts one at a time (each entry is its
 * own purchase; the classic one-transaction rule would pay only the first).
 */
export function computeDepositBudgetGrant(
  budget: number,
  used: number,
  quantity: number,
): DepositBudgetGrant {
  if (!Number.isFinite(budget) || budget <= 0) return { spins: 0, passesUsed: 0, exhausted: false };
  const remaining = Math.max(0, Math.floor(budget) - Math.max(0, Math.floor(used)));
  const credit = Math.min(Math.max(0, Math.floor(quantity)), remaining);
  return {
    spins: credit * FIRST_PURCHASE_SPINS_PER_PASS,
    passesUsed: credit,
    exhausted: remaining - credit <= 0,
  };
}

export interface FirstPurchaseGrant {
  /** Whether the one-time bonus should be marked consumed. */
  consume: boolean;
  /** Spins to add to the first-purchase promo's claimCount. */
  spins: number;
}

/**
 * Decide the first-purchase outcome. The bonus is ONE-TIME for everyone: the
 * first paid purchase defines it, and a subsequent purchase grants nothing
 * and must not re-consume. TWO rates (Boris 2026-07-10):
 *   - NEW players: every pass = 2 spins (1 → 2, 2 → 4, 4 → 8 …).
 *   - RETURNING players (past seasons): the classic promo, unchanged —
 *     every 2 passes = 1 spin, and a tiny first buy (qty < 2) still consumes
 *     the bonus with 0 spins (the all-in-one-transaction rule).
 */
export function computeFirstPurchaseGrant(
  alreadyGranted: boolean,
  quantity: number,
  isReturning = false,
): FirstPurchaseGrant {
  if (alreadyGranted) return { consume: false, spins: 0 };
  if (isReturning) {
    return { consume: quantity > 0, spins: classicFirstPurchaseSpins(quantity) };
  }
  const spins = firstPurchaseSpins(quantity);
  return { consume: spins > 0, spins };
}

/**
 * Which first-purchase offer a user should SEE. Same decision inputs as
 * computeFirstPurchaseGrant (alreadyGranted + isReturning) so the copy a
 * surface renders can never disagree with the grant the server would pay:
 *   - 'done'      → bonus consumed; show nothing.
 *   - 'returning' → classic rate (every 2 passes = 1 spin, no deadline).
 *   - 'new'       → every pass = FIRST_PURCHASE_SPINS_PER_PASS spins.
 * Logged-out / unknown users render the 'new' variant client-side.
 */
export type FirstPurchaseVariant = 'new' | 'returning' | 'done';

export function firstPurchaseVariant(
  alreadyGranted: boolean,
  isReturning: boolean,
): FirstPurchaseVariant {
  if (alreadyGranted) return 'done';
  return isReturning ? 'returning' : 'new';
}

/** Classic pair accumulator (returning players): every pass ever bought
 *  counts, and each completed PAIR pays one spin the moment it lands. There is
 *  NO deadline — the 24h window this used to enforce was removed on Richard's
 *  call (2026-08-05); the offer just runs until the passes pair up.
 *  Kills the split-buy trap: deposit → instant-seat 1-at-a-time (or MetaMask
 *  1-then-1) pays exactly what a single 2-pass cart always paid. */
export interface ClassicPairGrant {
  /** Passes counted after this purchase. */
  passesCounted: number;
  /** Spins to credit NOW (new completed pairs only). */
  spins: number;
}

export function computeClassicPairGrant(
  passesSoFar: number,
  spinsAwardedSoFar: number,
  quantity: number,
): ClassicPairGrant {
  const passesCounted = passesSoFar + Math.max(0, quantity);
  const spins = Math.max(0, Math.floor(passesCounted / 2) - spinsAwardedSoFar);
  return { passesCounted, spins };
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
