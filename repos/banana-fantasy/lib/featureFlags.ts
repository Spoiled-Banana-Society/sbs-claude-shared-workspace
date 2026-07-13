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
