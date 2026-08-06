
// ── computeClassicPairGrant — the returning-player pair accumulator ─────────
// (Boris 2026-07-28: kills the split-buy trap. Same money = same spins,
// whatever shape the checkout took. Richard 2026-08-05: 24h deadline removed —
// passes pair up whenever they land.)
import { describe, expect, it } from 'vitest';
import { computeClassicPairGrant } from '@/lib/promoMath';

describe('computeClassicPairGrant', () => {
  it('first purchase qty 1 counts the pass, pays nothing yet', () => {
    expect(computeClassicPairGrant(0, 0, 1))
      .toEqual({ passesCounted: 1, spins: 0 });
  });

  it('second 1-pass buy completes the pair → 1 spin (the Banana10084 case)', () => {
    expect(computeClassicPairGrant(1, 0, 1))
      .toEqual({ passesCounted: 2, spins: 1 });
  });

  it('one 2-pass cart pays 1 spin immediately — unchanged from the old rule', () => {
    expect(computeClassicPairGrant(0, 0, 2))
      .toEqual({ passesCounted: 2, spins: 1 });
  });

  it('split 1-then-10 pays like an 11-cart: 5 spins total', () => {
    const a = computeClassicPairGrant(1, 0, 10);
    expect(a.passesCounted).toBe(11);
    expect(a.spins).toBe(5);
  });

  it('pairs pay incrementally, never double: 3 passes then 1 more', () => {
    const a = computeClassicPairGrant(0, 0, 3);       // 3 → 1 spin
    expect(a.spins).toBe(1);
    const b = computeClassicPairGrant(3, 1, 1);       // 4th → 1 more
    expect(b.spins).toBe(1);
    const c = computeClassicPairGrant(4, 2, 1);       // 5th → nothing
    expect(c.spins).toBe(0);
  });

  it('no deadline: a pass bought long after the first still completes the pair', () => {
    // No time input exists anymore — a stored count of 1 plus a new pass pays,
    // full stop. This test pins the removal of the 24h expiry.
    expect(computeClassicPairGrant(1, 0, 1).spins).toBe(1);
  });
});
