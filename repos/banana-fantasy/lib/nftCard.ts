// Helpers for the obsidian NFT card image (the /api/og/team-card route).
// Builds the deterministic, self-contained image URL that becomes the token's
// metadata `Image` (OpenSea / marketplace / X) and the download/share asset.

import type { CardPlayer, CardTier } from '@/components/draft/TeamCardObsidian';

export function siteBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://banana-fantasy-sbs.vercel.app';
}

function base64url(s: string): string {
  const b64 = typeof Buffer !== 'undefined'
    ? Buffer.from(s, 'utf8').toString('base64')
    : btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface OgCardPayload {
  tier?: CardTier;
  passNo?: string | number;
  /** Team card identity line: on-chain token id (Team #) + league number. */
  teamNo?: string | number;
  leagueNo?: string | number;
  players?: CardPlayer[];
  preReveal?: boolean;
}

/** Absolute, deterministic 1080x1350 (4:5) card image URL. */
export function buildOgCardUrl(payload: OgCardPayload, base = siteBaseUrl()): string {
  const d = base64url(JSON.stringify(payload));
  return `${base}/api/og/team-card?d=${d}`;
}

/** The grey pre-reveal draft-pass image URL for a freshly minted token. */
export function buildDraftPassUrl(tokenId: string | number, base = siteBaseUrl()): string {
  return buildOgCardUrl({ preReveal: true, passNo: tokenId }, base);
}

/**
 * Tier-styled pre-reveal pass image — gold (HOF) / red (Jackpot) frame + badge.
 * Used for a wheel-won JP/HOF pass so the prize reads accurately on the
 * marketplace before its draft fills and reveals it into a team.
 */
export function buildTieredDraftPassUrl(
  tokenId: string | number,
  tier: 'hof' | 'jackpot' | 'jackhof',
  base = siteBaseUrl(),
): string {
  return buildOgCardUrl({ preReveal: true, passNo: tokenId, tier }, base);
}

// ── Exposure share card ──────────────────────────────────────────────────
export interface ExposureCardPayload {
  name: string;
  totalDrafts: number;
  rows: Array<{ tp: string; pct: number }>;
}

/**
 * URL for /api/og/exposure. Same base64url payload convention as
 * buildOgCardUrl so both cards are built and cached the same way.
 */
export function buildExposureCardUrl(payload: ExposureCardPayload, base = siteBaseUrl()): string {
  // base64url(), not Buffer — this runs in the BROWSER from the exposure page,
  // where Buffer isn't reliably available. Same helper buildOgCardUrl uses.
  const d = base64url(JSON.stringify(payload));
  return `${base}/api/og/exposure?d=${d}`;
}

/** URL for /api/og/badge — the shareable badge card. */
export function buildBadgeCardUrl(badgeId: string, displayName = '', base = siteBaseUrl()): string {
  const q = new URLSearchParams({ b: badgeId });
  if (displayName) q.set('n', displayName);
  return `${base}/api/og/badge?${q.toString()}`;
}
