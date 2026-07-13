/**
 * NY buy-support — the single place that decides "is this buyer in New York,
 * and should they get the Optimism on-ramp path instead of Base?"
 *
 * WHY THIS EXISTS: MoonPay blocks USDC-on-Base (and all of Optimism/Arbitrum/…)
 * for New York, but ALLOWS USDC on Optimism. So a NY card-buyer can't get USDC
 * on Base directly — we route them to buy on Optimism, then bridge to Base
 * behind the scenes. This module answers the one question the buy flow asks:
 * `isNyBuyer(user)`. Everything else (funding chain, sweep, bridge) hangs off it.
 *
 * SAFETY: this is pure, read-only logic. On its own it changes nothing. The NY
 * branch it gates is ALSO behind `isNyOnrampEnabled()` (a flag, default OFF), so
 * nothing is live until we deliberately turn it on. Non-NY buyers never touch
 * any of this — they run the exact Base flow they run today.
 */

/** The user fields this reads. Manual `usState` (admin/picker) is authoritative;
 *  IP-observed `ipRegion` is the fallback. Kept loose so both server (Firestore
 *  doc) and client (user metadata) can pass what they have. */
export interface UsStateSource {
  /** Authoritative resolved state — set by admin override or the state picker.
   *  Never overwritten by the IP capture. 2-letter US state, e.g. "NY". */
  usState?: string | null;
  usCountry?: string | null;
  /** IP-observed country (e.g. "US") — the fallback signal. */
  ipCountry?: string | null;
  /** IP-observed region/state (e.g. "NY") — the fallback signal. */
  ipRegion?: string | null;
}

const US_STATE_RE = /^[A-Z]{2}$/;

/**
 * Resolve the buyer's US state, authoritative-first:
 *   1. `usState` (manual admin flag or the state picker) — trusted, never
 *      overwritten by IP.
 *   2. else IP-observed `ipRegion`, but only when `ipCountry === 'US'`.
 *   3. else null (unknown or non-US).
 * Returns an uppercase 2-letter state or null.
 */
export function resolveUsState(u: UsStateSource | null | undefined): string | null {
  if (!u) return null;
  const manual = (u.usState ?? '').trim().toUpperCase();
  if (US_STATE_RE.test(manual)) return manual;
  const ipCountry = (u.ipCountry ?? '').trim().toUpperCase();
  const ipRegion = (u.ipRegion ?? '').trim().toUpperCase();
  if (ipCountry === 'US' && US_STATE_RE.test(ipRegion)) return ipRegion;
  return null;
}

/**
 * True when this buyer should get the New York on-ramp path (buy USDC on
 * Optimism → bridge to Base) instead of the direct Base buy. NY is the only US
 * state MoonPay blocks from USDC-on-Base. (Canada is blocked too but needs a
 * different, swap-based path — not handled here yet, on purpose.)
 */
export function isNyBuyer(u: UsStateSource | null | undefined): boolean {
  return resolveUsState(u) === 'NY';
}

/**
 * Master kill-switch for the entire NY on-ramp branch. Default OFF — the branch
 * is inert (NY buyers keep hitting the normal Base flow) until this is flipped
 * on. Env var so we can toggle without a code change; flip to disable instantly
 * if anything ever misbehaves.
 */
export function isNyOnrampEnabled(): boolean {
  return process.env.NY_ONRAMP_ENABLED === 'true';
}
