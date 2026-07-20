export interface WheelSegment {
  id: string;
  label: string;
  probability: number; // 0-1, all must sum to 1
  prizeType: 'draft_pass' | 'discount' | 'merch' | 'nothing' | 'custom';
  prizeValue?: number | string;
  color: string;
}

// Wheel odds (2026-06-11 rebalance): added a 2 Drafts tier (5%), funded by
// trimming 5/10/20 Drafts; HOF (2%) and Jackpot (1%) untouched.
// Rarity strictly decreases: 1 > 2 > 5 > 10 > 20.
// NOTE: outcome derivation + wedge rendering follow the ACTIVE period's
// committed segmentsSnapshot (stamped at period open), NOT this static
// array — so shipping a config change never diverges live odds from the
// period's Merkle commitment. The static arrays here are (a) the template
// the keeper stamps onto NEW periods and (b) the pre-period fallback.
const DRAFT_ONE = 0.8925;   // across 5 wedges
const DRAFT_TWO = 0.05;     // 1 wedge
const DRAFT_FIVE = 0.02;    // across 2 wedges
const DRAFT_TEN = 0.005;
const DRAFT_TWENTY = 0.0025;
const HOF = 0.02;
const JACKPOT = 0.01;

export const wheelSegments: WheelSegment[] = [
  { id: 'draft-1-a', label: '1 Draft', probability: DRAFT_ONE / 5, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-5-a', label: '5 Drafts', probability: DRAFT_FIVE / 2, prizeType: 'draft_pass', prizeValue: 5, color: '#22c55e' },
  { id: 'draft-1-b', label: '1 Draft', probability: DRAFT_ONE / 5, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'jackpot', label: 'Jackpot', probability: JACKPOT, prizeType: 'custom', prizeValue: 'jackpot', color: '#ef4444' },
  { id: 'draft-1-c', label: '1 Draft', probability: DRAFT_ONE / 5, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-10', label: '10 Drafts', probability: DRAFT_TEN, prizeType: 'draft_pass', prizeValue: 10, color: '#a78bfa' },
  { id: 'draft-2', label: '2 Drafts', probability: DRAFT_TWO, prizeType: 'draft_pass', prizeValue: 2, color: '#14b8a6' },
  { id: 'hof', label: 'HOF', probability: HOF, prizeType: 'custom', prizeValue: 'hof', color: '#d4af37' },
  { id: 'draft-1-d', label: '1 Draft', probability: DRAFT_ONE / 5, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-5-b', label: '5 Drafts', probability: DRAFT_FIVE / 2, prizeType: 'draft_pass', prizeValue: 5, color: '#22c55e' },
  { id: 'draft-1-e', label: '1 Draft', probability: DRAFT_ONE / 5, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-20', label: '20 Drafts', probability: DRAFT_TWENTY, prizeType: 'draft_pass', prizeValue: 20, color: '#f59e0b' },
];

export const WHEEL_SEGMENT_ANGLE = 360 / wheelSegments.length;

// ── JackHOF era wedge set (live from draft 201 / rolling era) ────────────────
// Identical to the classic wheel except wedge index 10: 'draft-1-e' becomes
// the 0.1% JackHOF wedge, funded from the 1-Draft pool (0.8925 → 0.8915
// across the remaining 4 wedges). Same 12-wedge geometry, so every angle is
// unchanged. The keeper stamps THIS set onto periods it opens once the
// rolling era is live (FilledLeaguesCount >= JACKHOF_WHEEL_FROM_FILLED).
const DRAFT_ONE_JH = 0.8915; // across 4 wedges
const JACKHOF = 0.001;

export const JACKHOF_WHEEL_FROM_FILLED = 200;

export const jackhofWheelSegments: WheelSegment[] = [
  { id: 'draft-1-a', label: '1 Draft', probability: DRAFT_ONE_JH / 4, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-5-a', label: '5 Drafts', probability: DRAFT_FIVE / 2, prizeType: 'draft_pass', prizeValue: 5, color: '#22c55e' },
  { id: 'draft-1-b', label: '1 Draft', probability: DRAFT_ONE_JH / 4, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'jackpot', label: 'Jackpot', probability: JACKPOT, prizeType: 'custom', prizeValue: 'jackpot', color: '#ef4444' },
  { id: 'draft-1-c', label: '1 Draft', probability: DRAFT_ONE_JH / 4, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-10', label: '10 Drafts', probability: DRAFT_TEN, prizeType: 'draft_pass', prizeValue: 10, color: '#a78bfa' },
  { id: 'draft-2', label: '2 Drafts', probability: DRAFT_TWO, prizeType: 'draft_pass', prizeValue: 2, color: '#14b8a6' },
  { id: 'hof', label: 'HOF', probability: HOF, prizeType: 'custom', prizeValue: 'hof', color: '#d4af37' },
  { id: 'draft-1-d', label: '1 Draft', probability: DRAFT_ONE_JH / 4, prizeType: 'draft_pass', prizeValue: 1, color: '#94a3b8' },
  { id: 'draft-5-b', label: '5 Drafts', probability: DRAFT_FIVE / 2, prizeType: 'draft_pass', prizeValue: 5, color: '#22c55e' },
  { id: 'jackhof', label: 'JackHOF', probability: JACKHOF, prizeType: 'custom', prizeValue: 'jackhof', color: '#ef6c37' },
  { id: 'draft-20', label: '20 Drafts', probability: DRAFT_TWENTY, prizeType: 'draft_pass', prizeValue: 20, color: '#f59e0b' },
];

/**
 * Display-only lookup across every wedge id that has ever existed in any
 * config generation — for feeds/proof pages rendering historical spins
 * regardless of which period (and wedge set) they came from.
 */
export const allKnownSegmentsById: Map<string, WheelSegment> = new Map(
  [...wheelSegments, ...jackhofWheelSegments].map((s) => [s.id, s]),
);
