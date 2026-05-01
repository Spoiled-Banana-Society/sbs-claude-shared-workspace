/**
 * Single source of truth for environment-dependent config — origins,
 * backend URLs, RTDB URL. Replaces the dozens of scattered
 * `process.env.FOO || 'banana-fantasy-sbs.vercel.app'` fallbacks that
 * silently routed prod misconfigs back to staging.
 *
 * Policy:
 *   - Env var set → use it.
 *   - Env var unset on staging → fall back to staging defaults.
 *   - Env var unset on prod → throw at call time. Better to crash loudly
 *     than to silently send prod users / prod writes to staging
 *     resources.
 *
 * Anywhere in the app that needs a canonical URL or service URL should
 * pull from here, not its own env.MY_VAR fallback.
 */

const STAGING_APP_ORIGIN = 'https://banana-fantasy-sbs.vercel.app';
const STAGING_DRAFTS_API = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const STAGING_DRAFT_SERVER = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';
const STAGING_RTDB = 'https://sbs-staging-env-default-rtdb.firebaseio.com';

export function isStagingEnv(): boolean {
  return process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';
}

function envOrStagingFallback(envVar: string | undefined, stagingDefault: string, varName: string): string {
  const trimmed = envVar?.trim();
  if (trimmed) return trimmed.replace(/\/$/, '');
  if (isStagingEnv()) return stagingDefault;
  throw new Error(`${varName} is required outside of staging`);
}

/** Public origin of the app (referral links, share URLs, OG tags, KYC redirects). */
export function appOrigin(): string {
  return envOrStagingFallback(
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
    STAGING_APP_ORIGIN,
    'NEXT_PUBLIC_APP_URL',
  );
}

/** Go drafts REST API URL. */
export function draftsApiUrl(): string {
  return envOrStagingFallback(
    process.env.NEXT_PUBLIC_DRAFTS_API_URL ?? process.env.NEXT_PUBLIC_SBS_API_URL,
    STAGING_DRAFTS_API,
    'NEXT_PUBLIC_DRAFTS_API_URL',
  );
}

/** Go WebSocket draft server URL. */
export function draftServerUrl(): string {
  return envOrStagingFallback(
    process.env.NEXT_PUBLIC_DRAFT_SERVER_URL,
    STAGING_DRAFT_SERVER,
    'NEXT_PUBLIC_DRAFT_SERVER_URL',
  );
}

/** Firebase RTDB URL (server-side admin SDK). */
export function rtdbUrl(): string {
  return envOrStagingFallback(
    process.env.NEXT_PUBLIC_DATABASE_URL ?? process.env.PROD_RT_DB_URL ?? process.env.TEST_RT_DB_URL,
    STAGING_RTDB,
    'NEXT_PUBLIC_DATABASE_URL',
  );
}
