// Shared client-side derivation for the "Chase Your Pick" promo card. Every
// promo surface (home carousel, /promos grid, drafting sidebar) renders the
// SAME live state from this so the card reads identically everywhere.
//
// State lives on the promo doc (written server-side by recordPickChase):
//   - modalContent.chaseTargetSlot : the pick slot (1–10) they're chasing
//   - modalContent.chaseRunLength  : drafts filled in the CURRENT run
//   - timerEndTime                 : 24h countdown end (top-level, ISO)
//   - progressCurrent / progressMax: the x/5 meter (next-hit spins / 5)
//
// A chase is ACTIVE only while a target is set AND the 24h hasn't elapsed.
// Otherwise it's DORMANT — the card shows "draft to lock your pick" and a full
// 24:00:00 clock that hasn't started.

import type { Promo } from '@/types';

export const CHASE_MAX_SPINS = 5;

export interface ChaseState {
  /** true while a pick is locked and the 24h is still running. */
  active: boolean;
  /** the pick slot (1–10) being chased, or null when dormant. */
  slot: number | null;
  /** Free Spins won if they land the slot on their NEXT filled draft (1–5). */
  nextHit: number;
  /** which draft-in-run the next fill is — 2 = "2nd draft", matches the ladder. */
  nextDraftOrdinal: number;
  /** true once the reward has hit the 5-Spin cap. */
  isMax: boolean;
}

export function deriveChaseState(promo: Promo | null | undefined): ChaseState {
  const mc = (promo?.modalContent || {}) as Record<string, unknown>;
  const slot = typeof mc.chaseTargetSlot === 'number' ? (mc.chaseTargetSlot as number) : null;
  const runLength = typeof mc.chaseRunLength === 'number' ? (mc.chaseRunLength as number) : 0;
  const endMs = promo?.timerEndTime ? new Date(promo.timerEndTime).getTime() : 0;
  const active = slot != null && endMs > Date.now();
  // Landing the slot on the NEXT draft is the (runLength+1)-th draft of the run;
  // the ladder pays min(runLength, 5) for it (2nd draft = 1 … 6th+ = 5 MAX).
  const nextHit = Math.min(runLength, CHASE_MAX_SPINS);
  return {
    active,
    slot: active ? slot : null,
    nextHit: active ? nextHit : 0,
    nextDraftOrdinal: runLength + 1,
    isMax: active && nextHit >= CHASE_MAX_SPINS,
  };
}

/** "1st", "2nd", "3rd", "4th" … for the draft-in-run label. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
