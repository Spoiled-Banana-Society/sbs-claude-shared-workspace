// Server-side feature flags, env-gated. Default OFF so unfinished/risky work can
// ship dark and be flipped on only once verified on staging.

/**
 * When ON, winning Jackpot/HOF on the wheel MINTS a real BBB4 pass NFT (marked
 * JP/HOF + wheel-origin) instead of only bumping a queue counter — so the prize
 * is a real, sellable asset. Off by default; flip via env `WHEEL_JPHOF_MINT_PASS=1`.
 * Read as a function (not a module const) so the env can be toggled without a
 * code change taking effect only at process start.
 */
export function isWheelJpHofPassEnabled(): boolean {
  return process.env.WHEEL_JPHOF_MINT_PASS === '1';
}

/**
 * When ON, every paid pass purchase also grants one PURCHASE spin (counter
 * `purchaseSpins`, separate from promo `wheelSpins`). A purchase spin pays the
 * wedge value MINUS ONE — the first draft on the wheel is the seat they already
 * bought, so only the excess is a bonus. Promo spins are untouched and keep
 * paying full value.
 *
 * Off by default; flip via env `SPIN_ON_PURCHASE=1`. The client half of the
 * feature reads `NEXT_PUBLIC_SPIN_ON_PURCHASE` (see lib/spinTypes.ts) — BOTH
 * must be set for the feature to be fully live.
 *
 * Settlement is safe with the flag off by construction: subtract-1 keys off the
 * spin's SOURCE, and with the flag off no purchase spin is ever granted, so no
 * spin can take the subtract-1 path.
 */
export function isSpinOnPurchaseEnabled(): boolean {
  return process.env.SPIN_ON_PURCHASE === '1';
}
