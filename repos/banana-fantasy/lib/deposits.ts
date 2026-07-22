// Deposit bankroll (Phase 1) — the whole feature is DARK unless the Vercel env
// var NEXT_PUBLIC_DEPOSIT_ENABLED is exactly 'true'. Flipping it off returns
// every entry point to pre-deposit behavior byte-for-byte.
export const DEPOSITS_ENABLED = process.env.NEXT_PUBLIC_DEPOSIT_ENABLED === 'true';

/** Entry price in whole dollars — mirrors the $25 pass price (lib/pricing.ts). */
export const ENTRY_PRICE_USD = 25;

/** Add Funds presets, in dollars the user RECEIVES (card fees ride on top).
 *  $25/$50/$100/$500 per Richard 2026-07-21 (mirrors the buy modal's spread). */
export const DEPOSIT_PRESETS_USD = [25, 50, 100, 500];

/** One-tap entries (Richard 2026-07-22, raised $1k→$5k same day): external
 *  wallets sign their first permit for this cap instead of the exact price —
 *  same single gasless signature, but the leftover allowance makes every
 *  later entry signature-free. $5,000 = 200 entries; real per-user exposure
 *  is min(cap, wallet balance), so the cap only binds whales. The wallet's
 *  own signing screen discloses the cap ("Spending cap: 5,000 USDC"). */
export const ONE_TAP_ALLOWANCE_USD = 5000;
