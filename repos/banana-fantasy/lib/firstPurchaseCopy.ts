// Single source for the client-side first-purchase offer copy, keyed by the
// server-computed `firstPurchaseVariant` ('new' | 'returning' | 'done' — see
// lib/promoMath.ts firstPurchaseVariant, delivered on /api/owner/balance and
// its SSE stream). Every number here is derived from the promoMath helpers the
// SERVER grants with, so the pitch can never promise more than the grant pays:
//   - NEW players: every pass = 2 promo spins (firstPurchaseSpins), and every
//     spin wins at least 1 Free Draft (minimum wheel wedge = 1) → buy 1, get
//     at least 2 drafts free; max wedge 20 → up to 40 Free Drafts.
//   - RETURNING players: classic rate — every 2 passes bought, whenever, = 1
//     promo spin (classicFirstPurchaseSpins / computeClassicPairGrant, no
//     deadline) → buy 2, get at least 1 draft free.
// Bonus Spins (Spin-on-Purchase) pay wedge-minus-one and are NEVER counted in
// any guarantee here — they're mentioned only by surfaces already gated on
// that feature flag.

import type { FirstPurchaseVariant } from '@/lib/promoMath';
import { firstPurchaseSpins, classicFirstPurchaseSpins } from '@/lib/promoMath';
import { wheelSegments, jackhofWheelSegments } from '@/lib/wheelConfig';
import { SPIN_ON_PURCHASE_UI_ENABLED, bonusDraftsFor } from '@/lib/spinTypes';
import { ENTRY_PRICE_USD } from '@/lib/deposits';

export type { FirstPurchaseVariant } from '@/lib/promoMath';

/**
 * Biggest draft payout on any wedge of any live wheel set. Derived, not
 * hardcoded, so re-tuning the wheel can never leave the promo copy promising
 * a ceiling the wheel stopped paying.
 */
const MAX_WEDGE_DRAFTS = Math.max(
  ...[...wheelSegments, ...jackhofWheelSegments]
    .filter((s) => s.prizeType === 'draft_pass' && typeof s.prizeValue === 'number')
    .map((s) => s.prizeValue as number),
);

export interface FirstBuyOutcome {
  /** Wheel spins the purchase grants: promo spins + (flag-gated) Bonus Spins. */
  spins: number;
  /** Drafts the player is certain to end up with — INCLUDING the passes bought. */
  guaranteed: number;
  /** Best possible total drafts, every spin landing the top wedge. */
  max: number;
  /** `max` priced at the entry fee, for the "($1,500)" kicker. */
  maxValueUsd: number;
}

/**
 * What a NEW player's first purchase of `quantity` passes is actually worth,
 * counted as TOTAL drafts in hand — the passes they bought PLUS everything the
 * wheel pays (Richard 2026-07-30). Counting the bought pass is what makes the
 * ceiling a round 60 and, more usefully, makes the guarantee (3) match the spin
 * count (3) instead of sitting one below it and reading as a typo.
 *
 * Bonus Spins are included here but ONLY via the client-visible flag: they pay
 * wedge-MINUS-ONE (the buyer already owns the first draft), so they lift the
 * ceiling but can pay zero and must never lift the guarantee.
 */
export function newPlayerFirstBuy(
  quantity: number,
  /**
   * Whether Bonus Spins are actually being granted. Defaults to the
   * client-visible flag; SERVER callers pass the AND of both halves of the
   * feature flag, since a server that isn't granting Bonus Spins must never
   * ship copy that counts them.
   */
  bonusSpinsEnabled: boolean = SPIN_ON_PURCHASE_UI_ENABLED,
): FirstBuyOutcome {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  const promoSpins = firstPurchaseSpins(qty);
  const bonusSpins = bonusSpinsEnabled ? qty : 0;
  // Every promo spin pays at least the minimum wedge (1 draft); a Bonus Spin
  // can land that same wedge and pay 0, so it adds nothing to the floor.
  const guaranteed = qty + promoSpins;
  const max =
    qty
    + promoSpins * MAX_WEDGE_DRAFTS
    + bonusSpins * bonusDraftsFor('purchase', MAX_WEDGE_DRAFTS);
  return {
    spins: promoSpins + bonusSpins,
    guaranteed,
    max,
    maxValueUsd: max * ENTRY_PRICE_USD,
  };
}

/**
 * The RETURNING player's equivalent (classic rate: every 2 passes = 1 promo
 * spin). Same shape and same counting rule as newPlayerFirstBuy — passes bought
 * PLUS what the wheel pays — so both variants can share one set of copy and
 * differ only in the quantity (Boris 2026-07-30). Buying 2 lands on the same
 * headline numbers as a new player buying 1: 3 guaranteed, 3 spins.
 */
export function returningFirstBuy(
  quantity: number,
  bonusSpinsEnabled: boolean = SPIN_ON_PURCHASE_UI_ENABLED,
): FirstBuyOutcome {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  const promoSpins = classicFirstPurchaseSpins(qty);
  const bonusSpins = bonusSpinsEnabled ? qty : 0;
  const guaranteed = qty + promoSpins;
  const max =
    qty
    + promoSpins * MAX_WEDGE_DRAFTS
    + bonusSpins * bonusDraftsFor('purchase', MAX_WEDGE_DRAFTS);
  return { spins: promoSpins + bonusSpins, guaranteed, max, maxValueUsd: max * ENTRY_PRICE_USD };
}

/** The quantity each variant's pitch is built around: new = 1, returning = 2
 *  (the smallest buy that earns a promo spin at the classic rate). */
export function firstBuyPitchQuantity(variant: FirstPurchasePitch): number {
  return variant === 'returning' ? 2 : 1;
}

/** The offer as a headline — "Buy 1, Get 2 Drafts Free" / "Buy 2, Get 1 Draft
 *  Free". Free = the promo spins earned, each guaranteeing a draft. */
export function firstPurchaseHeadline(variant: FirstPurchasePitch, bonusSpinsEnabled: boolean = SPIN_ON_PURCHASE_UI_ENABLED): string {
  const qty = firstBuyPitchQuantity(variant);
  const o = variant === 'returning' ? returningFirstBuy(qty, bonusSpinsEnabled) : newPlayerFirstBuy(qty, bonusSpinsEnabled);
  const free = o.guaranteed - qty;
  return `Buy ${qty}, Get ${free} Draft${free === 1 ? '' : 's'} Free`;
}

/**
 * What a surface should pitch: the three server-confirmed variants, or
 * 'unknown' when the viewer is logged out / the balance payload hasn't landed.
 * 'unknown' renders the NEW-PLAYER math but explicitly LABELED "New players"
 * (Richard 2026-07-28) — a returning player who logs in later and gets the
 * lesser classic rate must never feel baited by an unqualified pitch.
 */
export type FirstPurchasePitch = FirstPurchaseVariant | 'unknown';

/** One-line offer under the entry chooser's $25 join row. */
export function firstPurchaseEntryLine(variant: FirstPurchasePitch): string | null {
  // States the GUARANTEE, the same number the promo card leads with, so the
  // chooser and the card never quote two different figures (Boris 2026-07-30).
  if (variant === 'done') return null;
  const qty = firstBuyPitchQuantity(variant);
  const o = variant === 'returning' ? returningFirstBuy(qty) : newPlayerFirstBuy(qty);
  const label = variant === 'unknown' ? 'New players' : 'First purchase';
  return `${label}: buy ${qty} → ${o.guaranteed} Drafts guaranteed`;
}

/**
 * Quantity-reactive line for the buy modals ("Buy N → get X drafts free").
 * X = the promo spins this quantity actually earns (each spin guarantees at
 * least 1 Free Draft). For a returning player buying 1 pass the grant is 0 —
 * fall back to stating the pair offer instead of promising "0 drafts free".
 * Returns null for 'done' (bonus already used — no line at all).
 */
export function firstPurchaseBuyLine(variant: FirstPurchasePitch, quantity: number): string | null {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  if (variant === 'new' || variant === 'unknown') {
    // 'unknown' = logged out / flags not yet loaded → new-player math, but
    // explicitly labeled so a returning player never feels baited.
    const label = variant === 'unknown' ? 'New players' : 'First purchase';
    const drafts = firstPurchaseSpins(qty);
    if (drafts <= 0) return `${label}: buy 1, get 2 drafts free`;
    return `${label}: buy ${qty} → get ${drafts} drafts free`;
  }
  if (variant === 'returning') {
    const drafts = classicFirstPurchaseSpins(qty);
    if (drafts <= 0) return 'First purchase: buy 2, get 1 draft free';
    return `First purchase: buy ${qty} → get ${drafts} draft${drafts === 1 ? '' : 's'} free`;
  }
  return null;
}

/**
 * The fixed offer lines on the first-purchase promo card face (home carousel +
 * drafting sidebar). Each line is one complete idea and is rendered
 * whitespace-nowrap, so keep them short. The card TITLE carries the headline
 * ("Buy 1, Get 2 Drafts Free" / "Buy 2, Get 1 Draft Free") server-side.
 */
export function firstPurchaseCardLines(
  variant: FirstPurchaseVariant,
  /**
   * The promo's SERVER-built description. Preferred source: only the server
   * knows both halves of the Spin-on-Purchase flag, so only the server can say
   * whether Bonus Spins count toward the ceiling. Falling back to client-side
   * math would let the card quote 41 while the server quotes 60.
   */
  serverDescription?: string,
): string[] {
  if (variant === 'returning') {
    return [
      'Every 2 Passes = 1 Free Spin',
      'Each Spin wins 1+ Free Drafts',
    ];
  }
  // Server description is one ' · '-separated line per card row, optionally
  // carrying the logged-out "New players:" label (the card renders that as its
  // own tag). Single-row descriptions are normal — the card is deliberately one
  // line (Richard 2026-07-30: the separate spin-count row was noise, "from the
  // wheel" on the numbers line says it in three words).
  const parts = (serverDescription ?? '')
    .replace(/^\s*new players:\s*/i, '')
    .split(' · ')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts;

  return firstPurchaseCardRows(newPlayerFirstBuy(1));
}

/**
 * The offer as the CARD renders it: one idea across two rows.
 *
 * It is two rows purely for width — the promo card is 208px and its rows are
 * whitespace-nowrap, so the full sentence clips on both ends (measured, not
 * guessed). Splitting after the ceiling keeps every number and still lands
 * "from the wheel" at the end, which is the point.
 */
export function firstPurchaseCardRows(o: FirstBuyOutcome): string[] {
  return [
    `${o.guaranteed} Drafts Guaranteed — up to ${o.max}`,
    `from the wheel ($${o.maxValueUsd.toLocaleString('en-US')})`,
  ];
}

/** Same offer as one sentence, for surfaces with room (modal bullets). */
export function firstPurchaseOfferLine(o: FirstBuyOutcome): string {
  return `${o.guaranteed} Drafts Guaranteed — up to ${o.max} from the wheel ($${o.maxValueUsd.toLocaleString('en-US')})`;
}
