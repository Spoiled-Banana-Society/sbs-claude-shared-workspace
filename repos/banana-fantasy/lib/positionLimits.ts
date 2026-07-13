// Per-position auto-draft limits.
//
// Caps the auto-picker so a single seat can't grind out 8 QBs and freeze
// the other 9 drafters out of the position. Limits ONLY apply to what the
// auto-picker chooses ON ITS OWN (best-available in airplane mode, user
// timeout, bot picks). Manual clicks AND queued players bypass entirely —
// a queued player is a deferred manual pick, so the queue beats the caps.
//
// When every position is at its cap, the picker relaxes and grabs BPA so
// the draft never stalls — caps block, they never force fills.

// Caps are per TIERED slot — RB1/RB2 and WR1/WR2 are limited separately, since
// the draft pool has those as distinct positions (a team's WR1 ≠ its WR2).
export type Position = 'QB' | 'RB1' | 'RB2' | 'WR1' | 'WR2' | 'TE' | 'DST';
export const POSITIONS: readonly Position[] = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'DST'];

export type PositionLimits = Record<Position, number>;

export const DEFAULT_POSITION_LIMITS: PositionLimits = {
  QB: 3,
  RB1: 4,
  RB2: 1,
  WR1: 4,
  WR2: 2,
  TE: 3,
  DST: 2,
};

/** Master on/off for the auto-draft caps. When off, the auto-picker ignores
 *  all position caps (pure best-available / queue). Default ON. The setting is
 *  read by the draft engine when the draft room loads, so flipping it does NOT
 *  change a draft you're already in — only drafts you enter afterward. */
export const DEFAULT_LIMITS_ENABLED = true;

/** Reads the enabled flag from a stored doc / API payload. Defaults ON unless
 *  explicitly stored as false. */
export function readLimitsEnabled(partial: Partial<Record<string, unknown>> | null | undefined): boolean {
  return partial?.enabled === false ? false : true;
}

export const TOTAL_DRAFT_ROUNDS = 15;

/** Min/max each cap can be set to via the rankings UI. */
export const LIMIT_BOUNDS = { min: 0, max: 15 } as const;

/** Returns true if the partial-limits object would block a full 15-round
 *  roster fill (sum of caps < 15). Caller can use this to surface a UI
 *  warning, but saves are still allowed — the picker relaxes when stuck. */
export function isUnderfilled(limits: PositionLimits): boolean {
  return totalCap(limits) < TOTAL_DRAFT_ROUNDS;
}

export function totalCap(limits: PositionLimits): number {
  return POSITIONS.reduce((acc, p) => acc + limits[p], 0);
}

/** Merges a partial / unknown shape with defaults. Used at read boundaries
 *  (Firestore reads, API responses) so the rest of the code can rely on
 *  every position being present. */
export function applyDefaults(partial: Partial<Record<string, unknown>> | null | undefined): PositionLimits {
  const out = { ...DEFAULT_POSITION_LIMITS };
  if (!partial) return out;
  for (const pos of POSITIONS) {
    const v = partial[pos];
    if (typeof v === 'number' && Number.isInteger(v) && v >= LIMIT_BOUNDS.min && v <= LIMIT_BOUNDS.max) {
      out[pos] = v;
    }
  }
  return out;
}
