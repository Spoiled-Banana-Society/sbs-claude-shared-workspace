import { describe, it, expect } from 'vitest';
import { shouldUnlockFirstPurchase, type FirstPurchaseDrainInput } from '@/lib/promoMath';

describe('New-user first-purchase ping gate (fully-drained rule)', () => {
  // A genuine new user who has just finished their very last free draft:
  // spun the wheel, balances all zero, nothing to claim, nothing in progress.
  const drained: FirstPurchaseDrainInput = {
    firstPurchaseBonusGranted: false,
    firstPurchasePromoUnlocked: false,
    hasSpunWheel: true,
    freeDrafts: 0,
    jackpotEntries: 0,
    hofEntries: 0,
    wheelSpins: 0,
    hasPendingClaim: false,
    hasDraftInProgress: false,
  };

  it('fires only when the user is fully drained', () => {
    expect(shouldUnlockFirstPurchase(drained)).toBe(true);
  });

  it('does NOT fire while free drafts remain', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, freeDrafts: 1 })).toBe(false);
  });

  it('does NOT fire while a won Jackpot entry remains', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, jackpotEntries: 1 })).toBe(false);
  });

  it('does NOT fire while a won HOF entry remains', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, hofEntries: 1 })).toBe(false);
  });

  it('does NOT fire while an unspun wheel spin remains (could yield more drafts)', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, wheelSpins: 1 })).toBe(false);
  });

  it('does NOT fire while an unclaimed promo (e.g. Pick 10) is waiting', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, hasPendingClaim: true })).toBe(false);
  });

  it('does NOT fire while another draft is still in progress', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, hasDraftInProgress: true })).toBe(false);
  });

  it('never fires for a user who has not spun the wheel (not in the funnel)', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, hasSpunWheel: false })).toBe(false);
  });

  it('never fires for a user who already purchased', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, firstPurchaseBonusGranted: true })).toBe(false);
  });

  it('never fires twice (already unlocked)', () => {
    expect(shouldUnlockFirstPurchase({ ...drained, firstPurchasePromoUnlocked: true })).toBe(false);
  });

  it('Pick-10 scenario: finishing welcome drafts does NOT ping while a Pick 10 claim is pending', () => {
    // Welcome drafts done (balances 0) but a Pick 10 reward is sitting unclaimed.
    expect(shouldUnlockFirstPurchase({ ...drained, hasPendingClaim: true })).toBe(false);
    // After claiming, it grants a free draft → still not drained.
    expect(shouldUnlockFirstPurchase({ ...drained, freeDrafts: 1 })).toBe(false);
    // Only once that draft is also finished and nothing is left does it fire.
    expect(shouldUnlockFirstPurchase(drained)).toBe(true);
  });
});
