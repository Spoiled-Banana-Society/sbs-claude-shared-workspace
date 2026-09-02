import { describe, it, expect } from 'vitest';
import { API_CONFIG, isNewUserFlashActive, firstPurchaseSpinsPerPass } from '@/lib/api/config';
import {
  FIRST_PURCHASE_MAX_SPINS,
  FIRST_PURCHASE_SPINS_PER_PASS,
  firstPurchaseSpins,
  computeDepositBudgetGrant,
  computeFirstPurchaseGrant,
} from '@/lib/promoMath';
import { newPlayerFirstBuy, firstPurchaseFlashOverlay } from '@/lib/firstPurchaseCopy';

// $100 Day (Richard 2026-09-01): 24h NEW-player flash — every pass on the
// first order pays 4 promo spins instead of 2. Every spin lands at least one
// Free Draft, so buy 1 ($25) = at least 4 Free Drafts = $100 in drafts.
const F = API_CONFIG.promos.newUserFlash;
const DURING = F.startsAtMs + 60_000;
const BEFORE = F.startsAtMs - 60_000;
const AFTER = F.endsAtMs;

describe('$100 Day window', () => {
  it('is a 24-hour window', () => {
    expect(F.endsAtMs - F.startsAtMs).toBe(24 * 60 * 60 * 1000);
  });
  it.skipIf(!F.enabled)('is live only inside [start, end)', () => {
    expect(isNewUserFlashActive(BEFORE)).toBe(false);
    expect(isNewUserFlashActive(DURING)).toBe(true);
    expect(isNewUserFlashActive(F.endsAtMs - 1)).toBe(true);
    expect(isNewUserFlashActive(AFTER)).toBe(false);
  });
  it.skipIf(!F.enabled)('rate is 4/pass during, standing 2/pass otherwise', () => {
    expect(firstPurchaseSpinsPerPass(DURING)).toBe(4);
    expect(firstPurchaseSpinsPerPass(BEFORE)).toBe(FIRST_PURCHASE_SPINS_PER_PASS);
    expect(firstPurchaseSpinsPerPass(AFTER)).toBe(FIRST_PURCHASE_SPINS_PER_PASS);
  });
});

describe('$100 Day grant math', () => {
  it('buy 1 at the flash rate = 4 spins = $100 in drafts guaranteed', () => {
    expect(firstPurchaseSpins(1, 4)).toBe(4);
    const o = newPlayerFirstBuy(1, false, 4);
    expect(o.guaranteed - 1).toBe(4); // 4 free drafts on top of the bought pass
  });
  it('still caps at FIRST_PURCHASE_MAX_SPINS (10 passes at 4/pass)', () => {
    expect(firstPurchaseSpins(10, 4)).toBe(FIRST_PURCHASE_MAX_SPINS);
    expect(firstPurchaseSpins(20, 4)).toBe(FIRST_PURCHASE_MAX_SPINS);
  });
  it('one-shot grant pays the flash rate for new players only', () => {
    expect(computeFirstPurchaseGrant(false, 1, false, 4).spins).toBe(4);
    expect(computeFirstPurchaseGrant(false, 2, true, 4).spins).toBe(1); // returning = classic pair
    expect(computeFirstPurchaseGrant(true, 1, false, 4).spins).toBe(0);
  });
  it('deposit-budget grant pays the flash rate and shrinks the usable budget to the cap', () => {
    // $50 deposit → budget 2; buy 1 during the flash → 4 spins, 1 pass left.
    expect(computeDepositBudgetGrant(2, 0, 1, 4)).toEqual({ spins: 4, passesUsed: 1, exhausted: false });
    // $500 deposit → budget 20; at 4/pass only 10 passes fit under the 40 cap.
    expect(computeDepositBudgetGrant(20, 0, 20, 4)).toEqual({ spins: 40, passesUsed: 10, exhausted: true });
    // Default rate unchanged.
    expect(computeDepositBudgetGrant(2, 0, 1)).toEqual({ spins: 2, passesUsed: 1, exhausted: false });
  });
});

describe('$100 Day copy overlay', () => {
  it('is null outside the window', () => {
    expect(firstPurchaseFlashOverlay(false, BEFORE)).toBeNull();
    expect(firstPurchaseFlashOverlay(false, AFTER)).toBeNull();
  });
  it.skipIf(!F.enabled)('promises exactly what the grant pays: 4 drafts free on buy 1, $100', () => {
    const o = firstPurchaseFlashOverlay(false, DURING)!;
    expect(o.title).toBe('$100 DAY → BUY 1, GET 4 DRAFTS FREE');
    expect(o.explanation).toContain('$100');
    expect(o.explanation).toContain('4 Free Spins');
    expect(o.explanation).toContain('up to 10 passes');
    expect(o.endsAtIso).toBe(new Date(F.endsAtMs).toISOString());
  });
});
