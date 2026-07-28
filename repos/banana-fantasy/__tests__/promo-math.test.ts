
// ── computeClassicWindowGrant — the 24h returning-player window ─────────────
// (Boris 2026-07-28: kills the split-buy trap. Same money = same spins,
// whatever shape the checkout took.)
import { describe, expect, it } from 'vitest';
import { CLASSIC_FP_WINDOW_MS, computeClassicWindowGrant } from '@/lib/promoMath';

describe('computeClassicWindowGrant', () => {
  const T0 = 1_785_000_000_000;

  it('first purchase qty 1 opens the window, pays nothing yet', () => {
    expect(computeClassicWindowGrant(null, 0, 0, 1, T0))
      .toEqual({ passesCounted: 1, spins: 0, expired: false });
  });

  it('second 1-pass buy inside the window completes the pair → 1 spin (the Banana10084 case)', () => {
    expect(computeClassicWindowGrant(T0, 1, 0, 1, T0 + 43 * 60_000))
      .toEqual({ passesCounted: 2, spins: 1, expired: false });
  });

  it('one 2-pass cart pays 1 spin immediately — unchanged from the old rule', () => {
    expect(computeClassicWindowGrant(null, 0, 0, 2, T0))
      .toEqual({ passesCounted: 2, spins: 1, expired: false });
  });

  it('split 1-then-10 pays like an 11-cart: 5 spins total', () => {
    const a = computeClassicWindowGrant(T0, 1, 0, 10, T0 + 3_600_000);
    expect(a.passesCounted).toBe(11);
    expect(a.spins).toBe(5);
  });

  it('pairs pay incrementally, never double: 3 passes then 1 more', () => {
    const a = computeClassicWindowGrant(T0, 0, 0, 3, T0);       // 3 → 1 spin
    expect(a.spins).toBe(1);
    const b = computeClassicWindowGrant(T0, 3, 1, 1, T0);       // 4th → 1 more
    expect(b.spins).toBe(1);
    const c = computeClassicWindowGrant(T0, 4, 2, 1, T0);       // 5th → nothing
    expect(c.spins).toBe(0);
  });

  it('a purchase after 24h closes the window and pays nothing', () => {
    expect(computeClassicWindowGrant(T0, 1, 0, 5, T0 + CLASSIC_FP_WINDOW_MS + 1))
      .toEqual({ passesCounted: 1, spins: 0, expired: true });
  });

  it('exactly at the 24h boundary still pays', () => {
    expect(computeClassicWindowGrant(T0, 1, 0, 1, T0 + CLASSIC_FP_WINDOW_MS).spins).toBe(1);
  });
});
