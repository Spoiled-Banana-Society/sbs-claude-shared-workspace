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

const _STAGING_KEY = 'sbs-staging-mode';
const STAGING_API_OVERRIDE_KEY = 'sbs-staging-api-url';
const STAGING_WS_OVERRIDE_KEY = 'sbs-staging-ws-url';

// Build-time defaults (Cloud Run staging services)
// Runtime overrides still work via URL params: ?apiUrl=https://...&wsUrl=wss://...
const DEFAULT_STAGING_DRAFTS_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const DEFAULT_STAGING_DRAFT_SERVER_URL = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';
const STAGING_DRAFTS_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || DEFAULT_STAGING_DRAFTS_API_URL;
const STAGING_DRAFT_SERVER_URL = process.env.NEXT_PUBLIC_STAGING_DRAFT_SERVER_URL || DEFAULT_STAGING_DRAFT_SERVER_URL;

function getUrlParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  try { return new URLSearchParams(window.location.search); } catch { return null; }
}

export function isStagingMode(): boolean {
  if (typeof window === 'undefined') return false;

  // Capture runtime URL overrides regardless of mode — they're how
  // ephemeral Cloudflare tunnels get plumbed in.
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

  // Env-driven so prod Vercel can ship the same bundle and route to
  // production Cloud Run via NEXT_PUBLIC_DRAFTS_API_URL. Anything other
  // than 'staging' (incl. unset) means production-mode URL resolution.
  // Previously this always returned true, which meant pushing this code
  // to the prod Vercel project would have routed prod users at staging
  // backends — a hard prod-cutover blocker.
  return process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';
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
  return process.env.NEXT_PUBLIC_DRAFTS_API_URL || '';
}

/**
 * Returns the appropriate WebSocket URL based on staging mode.
 */
export function getDraftServerUrl(): string {
  if (isStagingMode()) {
    const url = getStagingWsUrl();
    if (url) return url;
  }
  return process.env.NEXT_PUBLIC_DRAFT_SERVER_URL || '';
}
