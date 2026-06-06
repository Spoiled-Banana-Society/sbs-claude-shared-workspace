import type { Ripeness } from '@/types';

/**
 * "Ripeness" — the dynamic banana badge every user carries by default.
 *
 * The tier is derived purely from how many PAID passes the user has BOUGHT
 * in BBB4 (free passes excluded; they don't even need to enter a draft —
 * buying is enough). The banana recolors green → spoiled-brown as they buy
 * more. This is NOT an unlockable: lower tiers don't persist, there's no
 * Firestore badge doc, and it never fires an unlock notification. It's
 * recomputed on every read and surfaced on the user payload + display-batch
 * so every render site can color the banana correctly per user.
 *
 * Tiers (first threshold the count is <= wins). 1 paid pass earns the first
 * banana (Unripe); everyone starts with a banana by default:
 *   Unripe  1–9     · Fresh 10–19   · Ripe 20–49
 *   Overripe 50–99  · Rotten 100–199 · Spoiled 200+
 */
interface TierDef {
  /** Inclusive upper bound of paid passes for this tier (Infinity = top). */
  max: number;
  label: string;
  color: string;
  range: string;
}

// Ordered low → high; the first tier whose `max` the count does not exceed wins.
const TIERS: TierDef[] = [
  { max: 9, label: 'Unripe', color: '#7cb342', range: '1–9' },
  { max: 19, label: 'Fresh', color: '#9bc63a', range: '10–19' },
  { max: 49, label: 'Ripe', color: '#f5c518', range: '20–49' },
  { max: 99, label: 'Overripe', color: '#e0a008', range: '50–99' },
  { max: 199, label: 'Rotten', color: '#a4632c', range: '100–199' },
  { max: Infinity, label: 'Spoiled', color: '#6f5733', range: '200+' },
];

/** Compute the ripeness tier from a paid-pass count. Always returns a tier
 *  (0 paid passes → Unripe), so every user has a banana. */
export function ripenessFromCount(count: number): Ripeness {
  const safe = Math.max(0, Math.floor(count || 0));
  const idx = TIERS.findIndex(t => safe <= t.max);
  const tierIdx = idx === -1 ? TIERS.length - 1 : idx;
  const t = TIERS[tierIdx];
  return { tier: tierIdx, label: t.label, color: t.color, range: t.range, count: safe };
}

/** One-line plain-English tooltip for the ripeness banana. */
export function ripenessTooltip(r: Ripeness): string {
  return `${r.label} · ${r.range} drafts bought in BBB4`;
}

/** The 6-tier ladder, for the read-only explainer in the profile catalog. */
export const RIPENESS_LADDER: Ripeness[] = TIERS.map((t, i) => ({
  tier: i,
  label: t.label,
  color: t.color,
  range: t.range,
  count: 0,
}));
