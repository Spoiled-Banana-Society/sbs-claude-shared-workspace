// Deposit bankroll (Phase 1) — the whole feature is DARK unless the Vercel env
// var NEXT_PUBLIC_DEPOSIT_ENABLED is exactly 'true'. Flipping it off returns
// every entry point to pre-deposit behavior byte-for-byte.
export const DEPOSITS_ENABLED = process.env.NEXT_PUBLIC_DEPOSIT_ENABLED === 'true';

/** Entry price in whole dollars — mirrors the $25 pass price (lib/pricing.ts). */
export const ENTRY_PRICE_USD = 25;

/** Add Funds presets, in dollars of USDC the user RECEIVES (fees ride on top). */
export const DEPOSIT_PRESETS_USD = [25, 50, 100, 200];
