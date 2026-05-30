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
  it('grants 1 spin per 4 passes', () => {
    expect(FIRST_PURCHASE_PASSES_PER_SPIN).toBe(4);
    expect(firstPurchaseSpins(4)).toBe(1);
    expect(firstPurchaseSpins(8)).toBe(2);
    expect(firstPurchaseSpins(12)).toBe(3);
  });

  it('floors partial quantities (buy 6 → 1 spin, buy 3 → 0)', () => {
    expect(firstPurchaseSpins(6)).toBe(1);
    expect(firstPurchaseSpins(3)).toBe(0);
    expect(firstPurchaseSpins(7)).toBe(1);
  });

  it('has NO cap — buy 40 first txn → 10 spins', () => {
    expect(firstPurchaseSpins(40)).toBe(10);
    expect(firstPurchaseSpins(100)).toBe(25);
  });

  it('returns 0 for non-positive / invalid quantities', () => {
    expect(firstPurchaseSpins(0)).toBe(0);
    expect(firstPurchaseSpins(-5)).toBe(0);
    expect(firstPurchaseSpins(NaN)).toBe(0);
  });

  describe('computeFirstPurchaseGrant (first-paid-purchase only)', () => {
    it('first purchase consumes the bonus and grants floor(qty/4)', () => {
      expect(computeFirstPurchaseGrant(false, 8)).toEqual({ consume: true, spins: 2 });
    });

    it('a tiny first purchase still CONSUMES the bonus with 0 spins (all-at-once rule)', () => {
      expect(computeFirstPurchaseGrant(false, 3)).toEqual({ consume: true, spins: 0 });
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

    it('landing exactly on the threshold shows full bar, not 0', () => {
      expect(computeMintProgress(4, 10, 6)).toEqual({ progressCurrent: 10, milestonesEarned: 1 });
    });

    it('first-purchase and mint promo advance together off the SAME quantity', () => {
      const qty = 6;
      const firstPurchase = computeFirstPurchaseGrant(false, qty);
      const mint = computeMintProgress(0, 10, qty);
      expect(firstPurchase.spins).toBe(1); // 6 → 1 first-purchase spin
      expect(mint.progressCurrent).toBe(6); // AND Buy-10 shows 6/10
    });
  });

  describe('firstPurchaseUpsell (mint-time nudge)', () => {
    it('buying 1 → need 3 more for the first spin (total 4)', () => {
      expect(firstPurchaseUpsell(1)).toEqual({
        spinsThisPurchase: 0,
        passesToNextSpin: 3,
        nextSpinTotal: 4,
      });
    });

    it('buying 5 → 1 spin now, 3 more for the next (total 8)', () => {
      expect(firstPurchaseUpsell(5)).toEqual({
        spinsThisPurchase: 1,
        passesToNextSpin: 3,
        nextSpinTotal: 8,
      });
    });

    it('buying 10 → 2 spins now, 2 more for the next (total 12)', () => {
      expect(firstPurchaseUpsell(10)).toEqual({
        spinsThisPurchase: 2,
        passesToNextSpin: 2,
        nextSpinTotal: 12,
      });
    });

    it('on a multiple of 4 the next spin is a full 4 away', () => {
      expect(firstPurchaseUpsell(8)).toEqual({
        spinsThisPurchase: 2,
        passesToNextSpin: 4,
        nextSpinTotal: 12,
      });
    });

    it('quantity 0 → buy 4 for the first spin', () => {
      expect(firstPurchaseUpsell(0)).toEqual({
        spinsThisPurchase: 0,
        passesToNextSpin: 4,
        nextSpinTotal: 4,
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
