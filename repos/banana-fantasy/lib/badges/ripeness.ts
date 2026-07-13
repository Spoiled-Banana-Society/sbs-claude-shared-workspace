import type { Ripeness } from '@/types';

/**
 * "Ripeness" — six banana badges that ripen as you DO more PAID BBB4 drafts.
 * Each tier is a real, equippable badge (like the champions/clubs): locked +
 * grey until you cross its threshold, then it turns its tier color and you can
 * equip whichever unlocked banana you want to show off.
 *
 * The count is the number of PAID drafts that actually FILLED — Go API tokens
 * with passType 'paid' that are bound to a league (binding happens at 10/10,
 * not at seat-taking; see lib/api/owner.ts → countPaidDraftsFilled). The
 * banana ripens through play, not purchase; free/promo drafts don't count and
 * a seat in a never-filled draft counts for nothing.
 *
 * Tiers (min paid drafts done to unlock):
 *   Unripe 1–9 · Fresh 10–19 · Ripe 20–49
 *   Overripe 50–99 · Rotten 100–199 · Spoiled 200+
 * Unripe is the floor everyone starts with (always unlocked) so every user
 * has a banana; the rest unlock by drafting.
 */
export interface RipenessTier {
  /** Stable key; the badge id is `ripeness-${key}`. */
  key: string;
  /** Min paid passes to unlock this tier. */
  min: number;
  label: string;
  /** Banana fill color for this tier. */
  color: string;
  range: string;
  /** Optional disc rim color (defaults to grey). Spoiled gets a gold frame to
   *  mark the rare top tier without lightening the (correctly darkest) banana. */
  rim?: string;
}

// Ordered low → high. Colors progress green → lime → yellow → orange → brown →
// dark (Spoiled darkest = most spoiled, framed in gold).
export const RIPENESS_TIERS: RipenessTier[] = [
  { key: 'unripe', min: 1, label: 'Unripe', color: '#4e9a2f', range: '1–9' },
  { key: 'fresh', min: 10, label: 'Fresh', color: '#aecb2b', range: '10–19' },
  { key: 'ripe', min: 20, label: 'Ripe', color: '#f7d117', range: '20–49' },
  { key: 'overripe', min: 50, label: 'Overripe', color: '#f0901b', range: '50–99' },
  { key: 'rotten', min: 100, label: 'Rotten', color: '#9c5a26', range: '100–199' },
  { key: 'spoiled', min: 200, label: 'Spoiled', color: '#7c5832', range: '200+', rim: '#cca54f' },
];

/** The badge id for a tier key. */
export function ripenessBadgeId(key: string): string {
  return `ripeness-${key}`;
}

/** Compute the CURRENT (highest reached) tier from a paid-DRAFTS-done count.
 *  Returns a tier object for any count (0 → Unripe shell with count:0), but the
 *  banana badge is only EARNED at 1+ paid drafts — callers gate display on
 *  `count >= 1` so a brand-new wallet (0 drafts) shows NO badge. */
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
  return `${r.label} · ${r.range} paid drafts done in BBB4`;
}

/** The 6-tier ladder, for any read-only explainer. */
export const RIPENESS_LADDER: Ripeness[] = RIPENESS_TIERS.map((t, i) => ({
  tier: i,
  label: t.label,
  color: t.color,
  range: t.range,
  count: 0,
}));
