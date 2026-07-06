import { describe, it, expect } from 'vitest';
import {
  FIRST_PURCHASE_PASSES_PER_SPIN,
  firstPurchaseSpins,
  computeFirstPurchaseGrant,
  computeMintProgress,
  firstPurchaseUpsell,
  promoAwardsSpin,
} from '@/lib/promoMath';

describe('First-purchase bonus math', () => {
  it('grants 1 spin per 2 passes (upgraded from 4 on 2026-07-06)', () => {
    expect(FIRST_PURCHASE_PASSES_PER_SPIN).toBe(2);
    expect(firstPurchaseSpins(2)).toBe(1);
    expect(firstPurchaseSpins(4)).toBe(2);
    expect(firstPurchaseSpins(6)).toBe(3);
  });

  it('floors partial quantities (buy 3 → 1 spin, buy 1 → 0)', () => {
    expect(firstPurchaseSpins(3)).toBe(1);
    expect(firstPurchaseSpins(1)).toBe(0);
    expect(firstPurchaseSpins(7)).toBe(3);
  });

  it('has NO cap — buy 40 first txn → 20 spins', () => {
    expect(firstPurchaseSpins(40)).toBe(20);
    expect(firstPurchaseSpins(100)).toBe(50);
  });

  it('returns 0 for non-positive / invalid quantities', () => {
    expect(firstPurchaseSpins(0)).toBe(0);
    expect(firstPurchaseSpins(-5)).toBe(0);
    expect(firstPurchaseSpins(NaN)).toBe(0);
  });

  describe('computeFirstPurchaseGrant (first-paid-purchase only)', () => {
    it('first purchase consumes the bonus and grants floor(qty/2)', () => {
      expect(computeFirstPurchaseGrant(false, 8)).toEqual({ consume: true, spins: 4 });
    });

    it('a tiny first purchase still CONSUMES the bonus with 0 spins (all-at-once rule)', () => {
      expect(computeFirstPurchaseGrant(false, 1)).toEqual({ consume: true, spins: 0 });
    });

    it('a second purchase grants nothing and does not re-consume', () => {
      expect(computeFirstPurchaseGrant(true, 12)).toEqual({ consume: false, spins: 0 });
    });
  });

  describe('computeMintProgress (interconnection with Buy-10)', () => {
    it('buy 6 on a fresh account → 6/10, no milestone', () => {
      expect(computeMintProgress(0, 10, 6)).toEqual({ progressCurrent: 6, milestonesEarned: 0 });
    });

    it('crossing the threshold earns a milestone and keeps the remainder', () => {
      // at 5/10, buy 20 → 25 total → 2 milestones, remainder 5
      expect(computeMintProgress(5, 10, 20)).toEqual({ progressCurrent: 5, milestonesEarned: 2 });
    });

    it('landing exactly on the threshold ROLLS OVER to 0 (promo repeats)', () => {
      expect(computeMintProgress(4, 10, 6)).toEqual({ progressCurrent: 0, milestonesEarned: 1 });
    });

    it('does NOT double-count on the NEXT purchase after a legacy full-bar landing (the extra-spin bug)', () => {
      // Docs written before the rollover change stored `max` (10) on an
      // exact-multiple landing. The next purchase must NOT re-count that
      // already-earned milestone. Buying another 10 → exactly 1 more, not 2.
      expect(computeMintProgress(10, 10, 10)).toEqual({ progressCurrent: 0, milestonesEarned: 1 });
      // A partial buy from the legacy full-bar state earns 0 (the 10 was a full cycle).
      expect(computeMintProgress(10, 10, 3)).toEqual({ progressCurrent: 3, milestonesEarned: 0 });
    });

    it('first-purchase and mint promo advance together off the SAME quantity', () => {
      const qty = 6;
      const firstPurchase = computeFirstPurchaseGrant(false, qty);
      const mint = computeMintProgress(0, 10, qty);
      expect(firstPurchase.spins).toBe(3); // 6 → 3 first-purchase spins
      expect(mint.progressCurrent).toBe(6); // AND Buy-10 shows 6/10
    });
  });

  describe('firstPurchaseUpsell (mint-time nudge)', () => {
    it('buying 1 → need 1 more for the first spin (total 2)', () => {
      expect(firstPurchaseUpsell(1)).toEqual({
        spinsThisPurchase: 0,
        passesToNextSpin: 1,
        nextSpinTotal: 2,
      });
    });

    it('buying 5 → 2 spins now, 1 more for the next (total 6)', () => {
      expect(firstPurchaseUpsell(5)).toEqual({
        spinsThisPurchase: 2,
        passesToNextSpin: 1,
        nextSpinTotal: 6,
      });
    });

    it('buying 10 → 5 spins now, next is a full 2 away (total 12)', () => {
      expect(firstPurchaseUpsell(10)).toEqual({
        spinsThisPurchase: 5,
        passesToNextSpin: 2,
        nextSpinTotal: 12,
      });
    });

    it('on a multiple of 2 the next spin is a full 2 away', () => {
      expect(firstPurchaseUpsell(8)).toEqual({
        spinsThisPurchase: 4,
        passesToNextSpin: 2,
        nextSpinTotal: 10,
      });
    });

    it('quantity 0 → buy 2 for the first spin', () => {
      expect(firstPurchaseUpsell(0)).toEqual({
        spinsThisPurchase: 0,
        passesToNextSpin: 2,
        nextSpinTotal: 2,
      });
    });
  });

  describe('promoAwardsSpin', () => {
    it('detects spin-awarding promo titles (case-insensitive)', () => {
      expect(promoAwardsSpin('Buy 10 → FREE SPIN')).toBe(true);
      expect(promoAwardsSpin('First Purchase → BONUS SPINS')).toBe(true);
      expect(promoAwardsSpin('4 Drafts Daily → FREE SPIN')).toBe(true);
    });

    it('is false for non-spin promos and empty input', () => {
      expect(promoAwardsSpin('Buy 2 → 1 Free')).toBe(false);
      expect(promoAwardsSpin('Refer a friend')).toBe(false);
      expect(promoAwardsSpin(undefined)).toBe(false);
    });
  });
});
