import type { Ripeness } from '@/types';

/**
 * "Ripeness" — six banana badges that unlock as you buy more PAID BBB4
 * drafts. Each tier is a real, equippable badge (like the champions/clubs):
 * locked + grey until you cross its threshold, then it turns its tier color
 * and you can equip whichever unlocked banana you want to show off.
 *
 * The count is the number of PAID draft passes in the wallet (USDC + card
 * purchases + card-fee-credit bonus drafts). Free/promo passes don't count.
 * The Go API tags each token `passType: 'paid' | 'free'`, so we count the
 * paid ones (see lib/api/owner.ts → countPaidPasses).
 *
 * Tiers (min paid passes to unlock):
 *   Unripe 1–9 · Fresh 10–19 · Ripe 20–49
 *   Overripe 50–99 · Rotten 100–199 · Spoiled 200+
 * Unripe is the floor everyone starts with (always unlocked) so every user
 * has a banana; the rest unlock by buying.
 */
export interface RipenessTier {
  /** Stable key; the badge id is `ripeness-${key}`. */
  key: string;
  /** Min paid passes to unlock this tier. */
  min: number;
  label: string;
  color: string;
  range: string;
}

// Ordered low → high.
export const RIPENESS_TIERS: RipenessTier[] = [
  { key: 'unripe', min: 0, label: 'Unripe', color: '#7cb342', range: '1–9' },
  { key: 'fresh', min: 10, label: 'Fresh', color: '#9bc63a', range: '10–19' },
  { key: 'ripe', min: 20, label: 'Ripe', color: '#f5c518', range: '20–49' },
  { key: 'overripe', min: 50, label: 'Overripe', color: '#e0a008', range: '50–99' },
  { key: 'rotten', min: 100, label: 'Rotten', color: '#a4632c', range: '100–199' },
  { key: 'spoiled', min: 200, label: 'Spoiled', color: '#6f5733', range: '200+' },
];

/** The badge id for a tier key. */
export function ripenessBadgeId(key: string): string {
  return `ripeness-${key}`;
}

/** Compute the CURRENT (highest reached) tier from a paid-pass count. Always
 *  returns a tier (0 paid → Unripe), so every user has a banana. */
export function ripenessFromCount(count: number): Ripeness {
  const safe = Math.max(0, Math.floor(count || 0));
  // Highest tier whose threshold the count meets.
  let chosen = RIPENESS_TIERS[0];
  for (const t of RIPENESS_TIERS) {
    if (safe >= t.min) chosen = t;
  }
  const tier = RIPENESS_TIERS.indexOf(chosen);
  return { tier, label: chosen.label, color: chosen.color, range: chosen.range, count: safe };
}

/** Badge ids for every ripeness tier the count has unlocked (cumulative). */
export function unlockedRipenessIds(count: number): string[] {
  const safe = Math.max(0, Math.floor(count || 0));
  return RIPENESS_TIERS.filter(t => safe >= t.min).map(t => ripenessBadgeId(t.key));
}

/** One-line plain-English tooltip for a ripeness tier. */
export function ripenessTooltip(r: Ripeness): string {
  return `${r.label} · ${r.range} paid drafts bought in BBB4`;
}

/** The 6-tier ladder, for any read-only explainer. */
export const RIPENESS_LADDER: Ripeness[] = RIPENESS_TIERS.map((t, i) => ({
  tier: i,
  label: t.label,
  color: t.color,
  range: t.range,
  count: 0,
}));
