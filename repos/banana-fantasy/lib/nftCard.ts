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
