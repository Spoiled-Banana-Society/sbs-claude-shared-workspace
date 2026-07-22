export const draftPassPricing = {
  pricePerPass: 25, // USD
  currency: 'USD' as const,
  bonuses: [] as { quantity: number; bonus: number }[],
};

// ── Card-fee credit → free draft ─────────────────────────────────────────────
// Card buyers pay a MoonPay fee on top of the $25 draft price. We credit that
// fee forward; once a user's accumulated card fees reach the price of one draft
// ($25) they earn 1 draft (granted as a PAID-type pass so it's usable in
// promos), and any remainder rolls over toward the next one.
//
// We can't read MoonPay's live fee (Privy brokers the popup; the charged fee
// never reaches our server), so these are MEASURED from real MoonPay debit
// quotes — total cost above face = "You pay" − qty×$25 (MoonPay fee + network
// + exchange spread) — captured 2026-05-31. Re-measure occasionally; updating
// the reward is just editing this table.
export const FREE_DRAFT_CREDIT_CENTS = draftPassPricing.pricePerPass * 100; // $25 → 2500¢

// qty → measured real card cost, in cents (debit, US).
// +$1 (100¢) added to every tier on 2026-06-21: PayPal/Venmo (via MoonPay) cost
// ~$1 more than debit card / Apple Pay, and we can't see which method the buyer
// picked (Privy brokers the MoonPay popup; the method/fee never reaches us), so
// we apply the higher figure uniformly. Base measured debit values (pre-bump)
// were 363/505/548/598/743/886/1031/1175/1319/1463.
const CARD_FEE_CENTS_BY_QTY: Record<number, number> = {
  1: 463,
  2: 605,
  3: 648,
  4: 698,
  5: 843,
  6: 986,
  7: 1131,
  8: 1275,
  9: 1419,
  10: 1563,
};

// Steady marginal card cost per extra draft above the measured range (the
// curve is linear at ~$1.44/draft from qty 5 up). Used to extrapolate qty > 10.
const CARD_FEE_MARGINAL_CENTS = 144;

/**
 * The card fee (in cents) for buying `quantity` drafts — measured table for
 * 1–10, linear extrapolation (~$1.44/draft) beyond 10. Defined with no gaps
 * for the full purchase range and always returns a finite, non-negative
 * integer. This is what we credit toward the user's free-draft reward.
 */
export function feeForQty(quantity: number): number {
  const q = Math.max(1, Math.floor(Number.isFinite(quantity) ? quantity : 1));
  const measured = CARD_FEE_CENTS_BY_QTY[q];
  if (measured != null) return measured;
  // qty > 10 (or any gap): extrapolate from the qty-10 anchor.
  return CARD_FEE_CENTS_BY_QTY[10] + (q - 10) * CARD_FEE_MARGINAL_CENTS;
}

/**
 * The card fee (in cents) for a deposit of `amountUsd` USDC — the deposit
 * bankroll's analogue of feeForQty. A deposit has no pass quantity, so we map
 * dollars onto the same measured curve at q = amount/$25, interpolating
 * linearly between measured points. Below $25 the qty-1 fee applies flat
 * (MoonPay's minimum fee dominates small purchases, so the fee doesn't shrink
 * with the amount). Above $250 it extrapolates at the same ~$1.44/$25 slope.
 */
export function feeForDepositUsd(amountUsd: number): number {
  const amt = Number.isFinite(amountUsd) ? Math.max(0, amountUsd) : 0;
  const q = amt / draftPassPricing.pricePerPass;
  if (q <= 1) return CARD_FEE_CENTS_BY_QTY[1];
  if (q >= 10) return Math.round(CARD_FEE_CENTS_BY_QTY[10] + (q - 10) * CARD_FEE_MARGINAL_CENTS);
  const lo = Math.floor(q);
  const hi = lo + 1;
  const frac = q - lo;
  return Math.round(CARD_FEE_CENTS_BY_QTY[lo] + frac * (CARD_FEE_CENTS_BY_QTY[hi] - CARD_FEE_CENTS_BY_QTY[lo]));
}
