/**
 * Score / rank / gameweek formatting utilities for standings.
 */

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
