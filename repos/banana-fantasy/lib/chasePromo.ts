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
  /** which attempt the NEXT filled draft is (unbounded — can exceed 5). Their
   *  next draft landing the slot pays min(attempt, 5) Free Spins. */
  attempt: number;
  /** Free Spins won if they land the slot on their next filled draft (1–5). */
  nextHit: number;
  /** true once the reward has hit the 5-Spin cap (attempts keep climbing). */
  isMax: boolean;
}

export function deriveChaseState(promo: Promo | null | undefined): ChaseState {
  const mc = (promo?.modalContent || {}) as Record<string, unknown>;
  const slot = typeof mc.chaseTargetSlot === 'number' ? (mc.chaseTargetSlot as number) : null;
  const runLength = typeof mc.chaseRunLength === 'number' ? (mc.chaseRunLength as number) : 0;
  const endMs = promo?.timerEndTime ? new Date(promo.timerEndTime).getTime() : 0;
  const active = slot != null && endMs > Date.now();
  // The NEXT filled draft is attempt #runLength, worth min(runLength, 5) Spins
  // (attempt 1 = 1 Spin … attempt 5 = 5, attempt 6+ = 5 MAX). Attempts are
  // unbounded; only the Spin reward caps — so we never show a "/5".
  const attempt = Math.max(runLength, 1);
  const nextHit = Math.min(attempt, CHASE_MAX_SPINS);
  return {
    active,
    slot: active ? slot : null,
    attempt: active ? attempt : 0,
    nextHit: active ? nextHit : 0,
    isMax: active && nextHit >= CHASE_MAX_SPINS,
  };
}
