import { describe, it, expect } from 'vitest';
import {
  calcSpinsForPurchase,
  calcBuyBonusFreeDrafts,
  applyCardPurchaseRewards,
} from '@/lib/db-firestore';
import { API_CONFIG } from '@/lib/api/config';

/**
 * Unit tests for the pure-math helpers that creditCompletedPurchase relies
 * on. These are the most error-prone parts of the credit flow (off-by-one
 * around milestone boundaries) and they have no Firestore dependency, so
 * they're testable without a database mock.
 *
 * The transactional integration of creditCompletedPurchase itself is
 * exercised by e2e tests against staging — that's the right level for the
 * Firestore-side behavior. Here we lock down the math.
 */

describe('calcSpinsForPurchase — 10-pass-buys-a-wheel-spin promo math', () => {
  const passesPerSpin = API_CONFIG.purchases.spinsPerPasses;

  it('zero passes earns zero spins', () => {
    expect(calcSpinsForPurchase(0)).toBe(0);
  });

  it('fewer than threshold earns zero spins', () => {
    expect(calcSpinsForPurchase(passesPerSpin - 1)).toBe(0);
  });

  it('exactly threshold earns one spin', () => {
    expect(calcSpinsForPurchase(passesPerSpin)).toBe(1);
  });

  it('two thresholds earns two spins', () => {
    expect(calcSpinsForPurchase(passesPerSpin * 2)).toBe(2);
  });

  it('rounds down on the partial — never partial spins', () => {
    expect(calcSpinsForPurchase(passesPerSpin * 2 + 3)).toBe(2);
  });
});

describe('calcBuyBonusFreeDrafts — Buy 2, get 1 Free promo math', () => {
  // Whether the test runs depends on the runtime config value of
  // API_CONFIG.promos.buyBonus.enabled. If the promo is disabled the
  // function short-circuits to 0 — guard against that assumption shifting.
  const promoEnabled = API_CONFIG.promos.buyBonus.enabled;
  const buyN = API_CONFIG.promos.buyBonus.buy;
  const bonusN = API_CONFIG.promos.buyBonus.bonusFreeDrafts;

  it('zero passes earns zero free drafts', () => {
    expect(calcBuyBonusFreeDrafts(0)).toBe(0);
  });

  if (promoEnabled) {
    it('exactly the buy threshold earns one bonus tier', () => {
      expect(calcBuyBonusFreeDrafts(buyN)).toBe(bonusN);
    });

    it('two buy thresholds earns two bonus tiers', () => {
      expect(calcBuyBonusFreeDrafts(buyN * 2)).toBe(bonusN * 2);
    });

    it('partial above threshold rounds down', () => {
      // buyN * 2 + (buyN - 1) → 2 full tiers, NOT 3
      expect(calcBuyBonusFreeDrafts(buyN * 2 + (buyN - 1))).toBe(bonusN * 2);
    });
  } else {
    it('returns zero when buyBonus is disabled in config', () => {
      expect(calcBuyBonusFreeDrafts(100)).toBe(0);
    });
  }
});

describe('applyCardPurchaseRewards — every 6th card purchase = 1 free draft', () => {
  // This is the highest-risk math — off-by-one on the rollover would
  // either credit users at 5 (too generous), at 7 (theft), or never reset
  // the counter (free draft per purchase forever after the first 6).

  it('first card purchase: count goes 0 → 1, no free draft', () => {
    expect(applyCardPurchaseRewards(0)).toEqual({
      nextCount: 1,
      freeDraftEarned: false,
    });
  });

  it('second card purchase: 1 → 2, no free draft', () => {
    expect(applyCardPurchaseRewards(1)).toEqual({
      nextCount: 2,
      freeDraftEarned: false,
    });
  });

  it('fifth card purchase: 4 → 5, no free draft (boundary minus one)', () => {
    expect(applyCardPurchaseRewards(4)).toEqual({
      nextCount: 5,
      freeDraftEarned: false,
    });
  });

  it('sixth card purchase: 5 → 0, free draft earned (boundary hit)', () => {
    expect(applyCardPurchaseRewards(5)).toEqual({
      nextCount: 0,
      freeDraftEarned: true,
    });
  });

  it('seventh card purchase after rollover: 0 → 1, no free draft', () => {
    expect(applyCardPurchaseRewards(0)).toEqual({
      nextCount: 1,
      freeDraftEarned: false,
    });
  });

  it('handles negative prior count defensively (shouldnt happen but)', () => {
    expect(applyCardPurchaseRewards(-3)).toEqual({
      nextCount: 1,
      freeDraftEarned: false,
    });
  });

  it('handles already-overflowed count: count >= 6 still resets and credits', () => {
    // If somehow data drifted past 6 (manual admin write, etc), the next
    // purchase still earns the reward and resets — stricter behavior would
    // be to do nothing, but the spec is "every 6th = +1 free" so any value
    // past 5 should trigger the rollover.
    expect(applyCardPurchaseRewards(7)).toEqual({
      nextCount: 0,
      freeDraftEarned: true,
    });
  });
});
