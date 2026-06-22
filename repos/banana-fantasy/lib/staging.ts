/**
 * Staging environment detection and URL switching.
 * Activate staging mode by adding ?staging=true to any page URL.
 * Once activated, it persists in sessionStorage until the tab closes.
 *
 * Runtime URL overrides (critical for ephemeral Cloudflare tunnels):
 *   ?apiUrl=https://...   → overrides staging API URL
 *   ?wsUrl=wss://...      → overrides staging WS URL
 * These persist in sessionStorage so they survive page navigations.
 */

import { isProd } from './envGates';

const _STAGING_KEY = 'sbs-staging-mode';
const STAGING_API_OVERRIDE_KEY = 'sbs-staging-api-url';
const STAGING_WS_OVERRIDE_KEY = 'sbs-staging-ws-url';

// Build-time defaults (Cloud Run staging services)
// Runtime overrides still work via URL params: ?apiUrl=https://...&wsUrl=wss://...
const DEFAULT_STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const DEFAULT_STAGING_DRAFT_SERVER_URL = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';

// Fallback when the env var is unset. In STAGING this stays the hardcoded
// staging URL (isProd() is false → behavior byte-for-byte identical to before).
// In PROD it becomes '' so a forgotten NEXT_PUBLIC_STAGING_* var makes calls
// FAIL LOUDLY in QA instead of silently pointing prod traffic at the staging
// backend. Prod MUST set NEXT_PUBLIC_STAGING_DRAFTS_API_URL /
// NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL to the prod Go API + WS URLs.
const DRAFTS_API_FALLBACK = isProd() ? '' : DEFAULT_STAGING_DRAFTS_API_URL;
const DRAFT_SERVER_FALLBACK = isProd() ? '' : DEFAULT_STAGING_DRAFT_SERVER_URL;

const STAGING_DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || DRAFTS_API_FALLBACK;
const STAGING_DRAFT_SERVER_URL = process.env.NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL || DRAFT_SERVER_FALLBACK;

function getUrlParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  try { return new URLSearchParams(window.location.search); } catch { return null; }
}

export function isStagingMode(): boolean {
  // Server-side too: this entire deployment IS staging. Returning false here
  // made every server-side getDraftsApiUrl() fall through to
  // NEXT_PUBLIC_DRAFTS_API_URL — the OLD PROD Go API — so close-pipeline
  // reads (card writer, pick-10 backstop, reveal credits) silently 404'd.
  if (typeof window === 'undefined') return true;

  // Always use real server — entire site points at staging backend
  // Runtime URL overrides still work via ?apiUrl= and ?wsUrl= params
  try {
    const params = getUrlParams();
    if (params) {
      const apiUrl = params.get('apiUrl');
      const wsUrl = params.get('wsUrl');
      if (apiUrl) sessionStorage.setItem(STAGING_API_OVERRIDE_KEY, apiUrl);
      if (wsUrl) sessionStorage.setItem(STAGING_WS_OVERRIDE_KEY, wsUrl);
    }
  } catch {
    // SSR/prerender — sessionStorage not available
  }
  return true;
}

export function getStagingApiUrl(): string {
  if (typeof window !== 'undefined') {
    const override = sessionStorage.getItem(STAGING_API_OVERRIDE_KEY);
    if (override) return override;
  }
  return STAGING_DRAFTS_API_URL;
}

export function getStagingWsUrl(): string {
  if (typeof window !== 'undefined') {
    const override = sessionStorage.getItem(STAGING_WS_OVERRIDE_KEY);
    if (override) return override;
  }
  return STAGING_DRAFT_SERVER_URL;
}

/**
 * Returns the appropriate API base URL based on staging mode.
 */
export function getDraftsApiUrl(): string {
  if (isStagingMode()) {
    const url = getStagingApiUrl();
    if (url) return url;
  }
  // Reached only if getStagingApiUrl() returned '' (prod with the env var
  // unset). NEVER fall back to NEXT_PUBLIC_DRAFTS_API_URL (old prod Go API) or
  // to the staging default in prod — return the prod-gated fallback so prod
  // fails loudly rather than silently using staging.
  return DRAFTS_API_FALLBACK;
}

/**
 * Returns the appropriate WebSocket URL based on staging mode.
 */
export function getDraftServerUrl(): string {
  if (isStagingMode()) {
    const url = getStagingWsUrl();
    if (url) return url;
  }
  // Same reasoning as getDraftsApiUrl(): prod-gated fallback, never the staging
  // default in prod.
  return DRAFT_SERVER_FALLBACK;
}
