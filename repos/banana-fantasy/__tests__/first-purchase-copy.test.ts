import { describe, it, expect } from 'vitest';
import { newPlayerFirstBuy, firstPurchaseCardLines, firstPurchaseCardRows, firstPurchaseOfferLine } from '@/lib/firstPurchaseCopy';

// Totals-in-hand framing (Richard 2026-07-30): every number counts the passes
// the player BOUGHT plus what the wheel pays. That is what makes the ceiling a
// round 60 and the guarantee match the spin count instead of sitting one below.
describe('new-player first-purchase copy math', () => {
  it('buy 1 with Bonus Spins live: 3 spins, 3 guaranteed, up to 60 ($1,500)', () => {
    const r = newPlayerFirstBuy(1, true);
    expect(r.spins).toBe(3);        // 2 promo + 1 bonus
    expect(r.guaranteed).toBe(3);   // 1 bought + 1 per promo spin (bonus can pay 0)
    expect(r.max).toBe(60);         // 1 + 20 + 20 + (20-1)
    expect(r.maxValueUsd).toBe(1500);
  });

  it('the guarantee NEVER counts a Bonus Spin — it can pay zero', () => {
    expect(newPlayerFirstBuy(1, true).guaranteed).toBe(newPlayerFirstBuy(1, false).guaranteed);
  });

  it('with Bonus Spins off the ceiling drops rather than over-promising', () => {
    const off = newPlayerFirstBuy(1, false);
    expect(off.spins).toBe(2);
    expect(off.max).toBe(41); // 1 bought + 2 promo spins at the 20 wedge
  });

  it('scales linearly per pass: 2 passes = 6 guaranteed, 3 = 9', () => {
    expect(newPlayerFirstBuy(2, true).guaranteed).toBe(6);
    expect(newPlayerFirstBuy(3, true).guaranteed).toBe(9);
    expect(newPlayerFirstBuy(2, true).max).toBe(120);
  });

  it('non-positive quantities pay nothing rather than NaN', () => {
    for (const q of [0, -1, Number.NaN]) {
      const r = newPlayerFirstBuy(q, true);
      expect(r.spins).toBe(0);
      expect(r.guaranteed).toBe(0);
      expect(r.max).toBe(0);
    }
  });

  // One idea across two rows — two only because the 208px card clips a longer
  // nowrap line. No separate spin-count row (Richard 2026-07-30).
  it('card face ends on "from the wheel" and never says "free"/"win"', () => {
    const lines = firstPurchaseCardLines('new');
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => /Wheel Spins/i.test(l))).toBe(false);
    expect(lines[lines.length - 1]).toMatch(/from the wheel/);
    // One of the 60 is the pass they PAID for, so "win"/"free" would be a lie.
    expect(lines.join(' ')).not.toMatch(/free|win\b/i);
  });

  // Only the server knows whether Bonus Spins are being granted, so the card
  // must render the SERVER's line — otherwise it can quote 41 while the server
  // quotes 60.
  it('prefers the server description, dropping the logged-out label', () => {
    expect(
      firstPurchaseCardLines(
        'new',
        'New players: 3 Drafts Guaranteed — up to 60 · from the wheel ($1,500)',
      ),
    ).toEqual(['3 Drafts Guaranteed — up to 60', 'from the wheel ($1,500)']);
  });

  it('falls back to local math when the server sends nothing', () => {
    for (const bad of [undefined, '', '   ']) {
      expect(firstPurchaseCardLines('new', bad)).toEqual(
        firstPurchaseCardRows(newPlayerFirstBuy(1)),
      );
    }
  });

  // The card rows are width-constrained; the sentence form is for the modal.
  it('offer sentence carries the same numbers as the card rows', () => {
    const o = newPlayerFirstBuy(1, true);
    const sentence = firstPurchaseOfferLine(o);
    expect(sentence).toContain('3 Drafts Guaranteed');
    expect(sentence).toContain('up to 60');
    expect(sentence).toContain('from the wheel');
    expect(sentence).toContain('$1,500');
  });

  it('returning players keep the classic card copy untouched', () => {
    expect(firstPurchaseCardLines('returning')).toEqual([
      'Every 2 Passes = 1 Free Spin',
      'Each Spin wins 1+ Free Drafts',
      'In your first 24 hours',
    ]);
  });
});
