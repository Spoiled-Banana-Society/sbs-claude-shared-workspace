import { describe, it, expect } from 'vitest';
import {
  FIRST_PURCHASE_SPINS_PER_PASS,
  FIRST_PURCHASE_CLASSIC_PASSES_PER_SPIN,
  firstPurchaseSpins,
  classicFirstPurchaseSpins,
  computeFirstPurchaseGrant,
  computeMintProgress,
  firstPurchaseUpsell,
  firstPurchaseVariant,
  promoAwardsSpin,
} from '@/lib/promoMath';
import {
  firstPurchaseBuyLine,
  firstPurchaseEntryLine,
  firstPurchaseHeadline,
  newPlayerFirstBuy,
  returningFirstBuy,
} from '@/lib/firstPurchaseCopy';

describe('First-purchase bonus math', () => {
  it('grants 2 spins per pass (upgraded from 1-per-2 on 2026-07-10)', () => {
    expect(FIRST_PURCHASE_SPINS_PER_PASS).toBe(2);
    expect(firstPurchaseSpins(1)).toBe(2);
    expect(firstPurchaseSpins(2)).toBe(4);
    expect(firstPurchaseSpins(4)).toBe(8);
    expect(firstPurchaseSpins(6)).toBe(12);
  });

  it('has NO cap — buy 40 first txn → 80 spins', () => {
    expect(firstPurchaseSpins(40)).toBe(80);
    expect(firstPurchaseSpins(100)).toBe(200);
  });

  it('returns 0 for non-positive / invalid quantities', () => {
    expect(firstPurchaseSpins(0)).toBe(0);
    expect(firstPurchaseSpins(-5)).toBe(0);
    expect(firstPurchaseSpins(NaN)).toBe(0);
  });

  describe('computeFirstPurchaseGrant (first-paid-purchase, new players only)', () => {
    it('first purchase consumes the bonus and grants qty × 2', () => {
      expect(computeFirstPurchaseGrant(false, 8)).toEqual({ consume: true, spins: 16 });
    });

    it('even a 1-pass first buy earns (2 spins) — no zero-spin consume anymore', () => {
      expect(computeFirstPurchaseGrant(false, 1)).toEqual({ consume: true, spins: 2 });
    });

    it('a second purchase grants nothing and does not re-consume', () => {
      expect(computeFirstPurchaseGrant(true, 12)).toEqual({ consume: false, spins: 0 });
    });

    it('a RETURNING player gets the CLASSIC promo unchanged: every 2 passes = 1 spin', () => {
      expect(FIRST_PURCHASE_CLASSIC_PASSES_PER_SPIN).toBe(2);
      expect(classicFirstPurchaseSpins(2)).toBe(1);
      expect(classicFirstPurchaseSpins(6)).toBe(3);
      expect(computeFirstPurchaseGrant(false, 8, true)).toEqual({ consume: true, spins: 4 });
      // Classic all-in-one-transaction rule: a 1-pass first buy still consumes with 0 spins.
      expect(computeFirstPurchaseGrant(false, 1, true)).toEqual({ consume: true, spins: 0 });
      // One-time for returning players too.
      expect(computeFirstPurchaseGrant(true, 8, true)).toEqual({ consume: false, spins: 0 });
    });

    it('a zero/invalid quantity does not consume the bonus', () => {
      expect(computeFirstPurchaseGrant(false, 0)).toEqual({ consume: false, spins: 0 });
      expect(computeFirstPurchaseGrant(false, NaN)).toEqual({ consume: false, spins: 0 });
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
      expect(firstPurchase.spins).toBe(12); // 6 passes → 12 first-purchase spins
      expect(mint.progressCurrent).toBe(6); // AND Buy-10 shows 6/10
    });
  });

  describe('firstPurchaseUpsell (mint-time nudge)', () => {
    it('every pass pays — buying 1 → 2 spins now, next 2 spins one pass away', () => {
      expect(firstPurchaseUpsell(1)).toEqual({
        spinsThisPurchase: 2,
        passesToNextSpin: 1,
        nextSpinTotal: 2,
      });
    });

    it('buying 5 → 10 spins now', () => {
      expect(firstPurchaseUpsell(5)).toEqual({
        spinsThisPurchase: 10,
        passesToNextSpin: 1,
        nextSpinTotal: 6,
      });
    });

    it('buying 10 → 20 spins now', () => {
      expect(firstPurchaseUpsell(10)).toEqual({
        spinsThisPurchase: 20,
        passesToNextSpin: 1,
        nextSpinTotal: 11,
      });
    });

    it('quantity 0 → the first pass earns the first spins', () => {
      expect(firstPurchaseUpsell(0)).toEqual({
        spinsThisPurchase: 0,
        passesToNextSpin: 1,
        nextSpinTotal: 1,
      });
    });
  });

  describe('firstPurchaseVariant (which offer a surface should pitch)', () => {
    it('mirrors the computeFirstPurchaseGrant inputs exactly', () => {
      expect(firstPurchaseVariant(false, false)).toBe('new');
      expect(firstPurchaseVariant(false, true)).toBe('returning');
      // Granted always wins — no offer left to pitch, whatever the audience.
      expect(firstPurchaseVariant(true, false)).toBe('done');
      expect(firstPurchaseVariant(true, true)).toBe('done');
    });
  });

  describe('firstPurchaseCopy lines (never promise more than the grant pays)', () => {
    it('new-player buy line = qty × 2 (the exact firstPurchaseSpins grant)', () => {
      expect(firstPurchaseBuyLine('new', 1)).toBe('First purchase: buy 1 → get 2 drafts free');
      expect(firstPurchaseBuyLine('new', 5)).toBe('First purchase: buy 5 → get 10 drafts free');
    });

    it('returning buy line = floor(qty/2) (the classic pair grant), with a pair fallback at qty 1', () => {
      expect(firstPurchaseBuyLine('returning', 1)).toBe('First purchase: buy 2, get 1 draft free');
      expect(firstPurchaseBuyLine('returning', 2)).toBe('First purchase: buy 2 → get 1 draft free');
      expect(firstPurchaseBuyLine('returning', 5)).toBe('First purchase: buy 5 → get 2 drafts free');
    });

    it('variant done → no lines anywhere', () => {
      expect(firstPurchaseBuyLine('done', 4)).toBeNull();
      expect(firstPurchaseEntryLine('done')).toBeNull();
    });

    it("unknown (logged-out / flags not loaded) → new-player math, explicitly labeled 'New players'", () => {
      expect(firstPurchaseEntryLine('unknown')).toBe('New players: buy 1 → 3 Drafts guaranteed');
      expect(firstPurchaseBuyLine('unknown', 3)).toBe('New players: buy 3 → get 6 drafts free');
    });

    // Boris review 2026-07-30: the entry line now quotes the GUARANTEE — the
    // same number the promo card leads with — so the chooser and the card can
    // never show two different figures. Both variants land on 3 because each
    // buys the same thing (new: 1 pass + 2 promo spins; returning: 2 passes +
    // 1 promo spin); only the quantity differs.
    it('entry-chooser lines quote the guarantee, matching the promo card', () => {
      expect(firstPurchaseEntryLine('new')).toBe('First purchase: buy 1 → 3 Drafts guaranteed');
      expect(firstPurchaseEntryLine('returning')).toBe('First purchase: buy 2 → 3 Drafts guaranteed');
    });

    it('returningFirstBuy mirrors the new-player shape at the classic rate', () => {
      const r = returningFirstBuy(2, true);
      expect(r.guaranteed).toBe(3);   // 2 passes + 1 promo spin
      expect(r.spins).toBe(3);        // 1 promo + 2 bonus
      const n = newPlayerFirstBuy(1, true);
      expect(r.max).toBe(n.max);      // both ceilings agree
      expect(r.maxValueUsd).toBe(n.maxValueUsd);
    });

    it('headlines differ only in the quantity', () => {
      expect(firstPurchaseHeadline('new', true)).toBe('Buy 1, Get 2 Drafts Free');
      expect(firstPurchaseHeadline('returning', true)).toBe('Buy 2, Get 1 Draft Free');
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

    it('the $1K first-purchase title intentionally does NOT trigger the wheel explainer (no wheel mechanics on that card)', () => {
      expect(promoAwardsSpin('First Purchase → WIN UP TO $1K IN DRAFTS')).toBe(false);
    });
  });
});
