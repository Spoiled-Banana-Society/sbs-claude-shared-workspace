/**
 * Staging environment detection and URL switching.
 * Activate staging mode by adding ?staging=true query param.
 * Once activated, it persists in sessionStorage until the tab closes.
 *
 * Runtime URL overrides (critical for ephemeral Cloudflare tunnels):
 *   ?apiUrl=https://...   → overrides staging API URL
 * These persist in sessionStorage so they survive page navigations.
 */

const STAGING_API_OVERRIDE_KEY = 'sbs-staging-api-url';

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

  // Always use real server — entire site points at staging backend.
  // Runtime URL overrides still work via ?apiUrl= params.
  try {
    const params = getUrlParams();
    if (params) {
      const apiUrl = params.get('apiUrl');
      if (apiUrl) sessionStorage.setItem(STAGING_API_OVERRIDE_KEY, apiUrl);
    }
  } catch {
    // SSR/prerender — sessionStorage not available
  }
  return true;
}

function stagingApiUrlFromEnv(): string {
  return (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || '').trim();
}

export function getStagingApiUrl(): string {
  if (typeof window !== 'undefined') {
    const override = sessionStorage.getItem(STAGING_API_OVERRIDE_KEY);
    if (override) return override;
  }
  return stagingApiUrlFromEnv();
}

function requireUrl(url: string, envVar: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error(`Missing ${envVar}. Configure the drafts API URL in your environment.`);
  }
  return trimmed;
}

/**
 * Returns the appropriate API base URL based on staging mode.
 * Throws when unset — never falls back to a hardcoded URL.
 */
export function getDraftsApiUrl(): string {
  if (isStagingMode()) {
    const url = getStagingApiUrl();
    if (url) return requireUrl(url, 'NEXT_PUBLIC_STAGING_DRAFTS_API_URL');
  }
  return requireUrl(process.env.NEXT_PUBLIC_DRAFTS_API_URL || '', 'NEXT_PUBLIC_DRAFTS_API_URL');
}
