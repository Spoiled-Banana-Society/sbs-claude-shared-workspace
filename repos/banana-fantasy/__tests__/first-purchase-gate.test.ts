import { describe, it, expect } from 'vitest';
import { applyCompletionGate } from '@/lib/promoMath';

describe('New-user first-purchase popup gate', () => {
  const base = {
    usedFreePass: true,
    pendingWheelWinnings: 1,
    firstPurchaseBonusGranted: false,
    firstPurchasePromoUnlocked: false,
  };

  it('decrements pending winnings on a completed free draft', () => {
    expect(applyCompletionGate({ ...base, pendingWheelWinnings: 3 })).toEqual({
      pendingWheelWinnings: 2,
      unlock: false,
    });
  });

  it('unlocks exactly when the last won draft finishes (1 → 0)', () => {
    expect(applyCompletionGate({ ...base, pendingWheelWinnings: 1 })).toEqual({
      pendingWheelWinnings: 0,
      unlock: true,
    });
  });

  it('does NOT decrement for paid drafts (only winnings count down)', () => {
    expect(applyCompletionGate({ ...base, usedFreePass: false, pendingWheelWinnings: 2 })).toEqual({
      pendingWheelWinnings: 2,
      unlock: false,
    });
  });

  it('never unlocks for a user who never won (pending already 0)', () => {
    expect(applyCompletionGate({ ...base, pendingWheelWinnings: 0 })).toEqual({
      pendingWheelWinnings: 0,
      unlock: false,
    });
  });

  it('does not re-unlock once already unlocked', () => {
    expect(
      applyCompletionGate({ ...base, pendingWheelWinnings: 1, firstPurchasePromoUnlocked: true }),
    ).toEqual({ pendingWheelWinnings: 0, unlock: false });
  });

  it('does not unlock for a user who already purchased', () => {
    expect(
      applyCompletionGate({ ...base, pendingWheelWinnings: 1, firstPurchaseBonusGranted: true }),
    ).toEqual({ pendingWheelWinnings: 0, unlock: false });
  });

  it('floors at 0 and never goes negative', () => {
    expect(applyCompletionGate({ ...base, pendingWheelWinnings: 0, firstPurchasePromoUnlocked: true }).pendingWheelWinnings).toBe(0);
  });
});
