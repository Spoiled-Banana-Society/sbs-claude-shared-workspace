export interface WheelSegment {
  id: string;
  label: string;
  probability: number; // 0-1, all must sum to 1
  prizeType: 'draft_pass' | 'discount' | 'merch' | 'nothing' | 'custom';
  prizeValue?: number | string;
  color: string;
}

// Wheel odds (2026-06-11 rebalance): added a 2 Drafts tier (5%), funded by
// trimming 5/10/20 Drafts; HOF (2%) and Jackpot (1%) untouched. Net ~5% cheaper
// per spin, and players win >1 draft ~2x more often (1-in-25 → 1-in-13).
// Rarity strictly decreases: 1 > 2 > 5 > 10 > 20.
const DRAFT_ONE = 0.8925;   // across 5 wedges
const DRAFT_TWO = 0.05;     // 1 wedge (new)
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
