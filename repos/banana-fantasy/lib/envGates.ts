/**
 * Environment gates for route availability — the split of the old single
 * `NEXT_PUBLIC_ENVIRONMENT === 'staging'` flag into two independent ones, so
 * PROD can have real payments ON while the test/faucet/debug surface is OFF.
 *
 * Backward-compatible by design: every gate still treats `env === 'staging'`
 * as enabled, so STAGING behavior is unchanged — no new env vars required on
 * staging, the existing workshop keeps working exactly as before.
 *
 *   - Money routes (card-mint, relay-buy/permit, gas-topup) → paymentsEnabled()
 *       PROD: set PAYMENTS_ENABLED=true.
 *   - Test/admin tooling (bots, debug) → testHelpersEnabled()
 *       PROD: leave TEST_HELPERS_ENABLED unset → off.
 *   - isProd() is a HARD block for the highest-risk routes (the free-mint
 *       faucet + destructive debug) so they can NEVER run in prod even if a
 *       flag is misconfigured.
 */

function env(): string | undefined {
  return process.env.NEXT_PUBLIC_ENVIRONMENT;
}

/** True only in production — a hard, flag-independent block. */
export function isProd(): boolean {
  const e = env();
  return e === 'prod' || e === 'production';
}

/** Real-money routes: enabled in prod (PAYMENTS_ENABLED) AND always on staging. */
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === 'true' || env() === 'staging';
}

/** Test/admin tooling: off in prod by default; on via TEST_HELPERS_ENABLED, and always on staging. */
export function testHelpersEnabled(): boolean {
  return process.env.TEST_HELPERS_ENABLED === 'true' || env() === 'staging';
}
