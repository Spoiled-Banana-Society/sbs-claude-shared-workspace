// Single source for the client-side first-purchase offer copy, keyed by the
// server-computed `firstPurchaseVariant` ('new' | 'returning' | 'done' — see
// lib/promoMath.ts firstPurchaseVariant, delivered on /api/owner/balance and
// its SSE stream). Every number here is derived from the promoMath helpers the
// SERVER grants with, so the pitch can never promise more than the grant pays:
//   - NEW players: every pass = 2 promo spins (firstPurchaseSpins), and every
//     spin wins at least 1 Free Draft (minimum wheel wedge = 1) → buy 1, get
//     at least 2 drafts free; max wedge 20 → up to 40 Free Drafts.
//   - RETURNING players: classic rate — every 2 passes bought inside the 24h
//     window from their first purchase = 1 promo spin (classicFirstPurchaseSpins
//     / computeClassicWindowGrant) → buy 2, get at least 1 draft free.
// Bonus Spins (Spin-on-Purchase) pay wedge-minus-one and are NEVER counted in
// any guarantee here — they're mentioned only by surfaces already gated on
// that feature flag.

import type { FirstPurchaseVariant } from '@/lib/promoMath';
import { firstPurchaseSpins, classicFirstPurchaseSpins } from '@/lib/promoMath';

export type { FirstPurchaseVariant } from '@/lib/promoMath';

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
  if (variant === 'returning') return 'First purchase: buy 2, get 1 draft free';
  if (variant === 'new') return 'First purchase: buy 1, get 2 drafts free';
  if (variant === 'unknown') return 'New players: buy 1, get 2 drafts free';
  return null;
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
    if (drafts <= 0) return 'First purchase: buy 2, get 1 draft free (first 24h)';
    return `First purchase: buy ${qty} → get ${drafts} draft${drafts === 1 ? '' : 's'} free (first 24h)`;
  }
  return null;
}

/**
 * The fixed offer lines on the first-purchase promo card face (home carousel +
 * drafting sidebar). Each line is one complete idea and is rendered
 * whitespace-nowrap, so keep them short. The card TITLE carries the headline
 * ("Buy 1, Get 2 Drafts Free" / "Buy 2, Get 1 Draft Free") server-side.
 */
export function firstPurchaseCardLines(variant: FirstPurchaseVariant): string[] {
  if (variant === 'returning') {
    return [
      'Every 2 Passes = 1 Free Spin',
      'Each Spin wins 1+ Free Drafts',
      'In your first 24 hours',
    ];
  }
  return [
    'Every Pass = 2 Free Spins',
    'Each Spin wins 1+ Free Drafts',
    'Win up to 40 Free Drafts',
    '($1,000 in Drafts)',
  ];
}
