/**
 * Server-side drafts API base URL — env only, no hardcoded fallbacks.
 * Checks STAGING_DRAFTS_API_URL, NEXT_PUBLIC_STAGING_DRAFTS_API_URL, then
 * legacy SBS_API_URL names used on some admin routes.
 */

function resolveServerDraftsApiUrl(): string {
  return (
    process.env.STAGING_DRAFTS_API_URL ||
    process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
    process.env.NEXT_PUBLIC_SBS_API_URL ||
    process.env.SBS_API_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
}

/** Returns the configured drafts API base URL or throws. */
export function getServerDraftsApiUrl(): string {
  const url = resolveServerDraftsApiUrl();
  if (!url) {
    throw new Error(
      'Missing drafts API URL. Set STAGING_DRAFTS_API_URL or NEXT_PUBLIC_STAGING_DRAFTS_API_URL.',
    );
  }
  return url;
}

/** Soft-fail variant for optional Go API reads (balance sync, etc.). */
export function tryGetServerDraftsApiUrl(): string | null {
  const url = resolveServerDraftsApiUrl();
  return url || null;
}
