/**
 * Score / rank / gameweek formatting utilities for standings.
 */

import { parseDraftNumber } from './batchProof';

export const SEASON_LABEL = 'BBB4';
export const LEAGUE_PREFIX = 'BBB League';
export const TEAM_PREFIX = 'BBB Team';

/** "BBB League #161" from a draft id like "2024-fast-draft-161", or from a raw number. */
export function formatLeagueName(draftIdOrNumber: string | number | null | undefined): string {
  if (draftIdOrNumber == null) return LEAGUE_PREFIX;
  if (typeof draftIdOrNumber === 'number') return `${LEAGUE_PREFIX} #${draftIdOrNumber}`;
  const n = parseDraftNumber(draftIdOrNumber);
  if (n) return `${LEAGUE_PREFIX} #${n}`;
  const trailing = draftIdOrNumber.match(/(\d+)$/)?.[1];
  return trailing ? `${LEAGUE_PREFIX} #${trailing}` : `${LEAGUE_PREFIX} ${draftIdOrNumber}`;
}

/** "BBB Team #4" — NFT identity */
export function formatTeamName(tokenId: string | number): string {
  return `${TEAM_PREFIX} #${tokenId}`;
}

/** "BBB Team #42 — alice" for marketplace; falls back to just team if no name */
export function formatOwnerTeamName(
  tokenId: string | number,
  displayName?: string | null,
): string {
  const base = formatTeamName(tokenId);
  const trimmed = displayName?.trim();
  return trimmed ? `${base} — ${trimmed}` : base;
}

/** Normalize backend display name like "BBB #764" → "BBB League #764". */
export function normalizeBackendLeagueName(raw: string): string {
  return raw.replace(/^BBB\s*#/, `${LEAGUE_PREFIX} #`);
}

/** Format a score to 2 decimal places with commas: 2074.759 → "2,074.76" */
export function formatScore(n: number | string | undefined | null): string {
  const val = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!Number.isFinite(val)) return '0.00';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format a rank with ordinal suffix: 1 → "1st", 3 → "3rd", 148 → "148th" */
export function formatRank(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '-';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Format gameweek for display: "2025REG-05" → "Week 5", or just number → "Week 5" */
export function formatGameweek(gw: string | number): string {
  if (typeof gw === 'number') return `Week ${gw}`;
  const match = gw.match(/(\d+)$/);
  if (match) return `Week ${parseInt(match[1], 10)}`;
  return `Week ${gw}`;
}
