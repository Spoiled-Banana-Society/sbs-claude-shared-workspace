import { test, expect } from '@playwright/test';

// Integration smoke for the first-purchase bonus promo.
//
// The GRANT math (4 passes = 1 spin, no cap, first-purchase-only,
// interconnection with Buy-10) and the new-user popup GATE are covered
// deterministically by the Vitest unit suite (__tests__/first-purchase-*.test.ts)
// against lib/promoMath.ts. They are NOT re-driven here because the only
// real entry points are on-chain (card-mint / staging-mint burn gas and need a
// funded admin wallet + real wallet address) — unsuitable for routine e2e.
//
// What this spec verifies against LIVE staging is the part that can only break
// in deployment: that the seed + types + /api/promos actually shipped and the
// new promo is served to users with the right shape. Full purchase lifecycle
// is in the manual staging checklist (see the plan's Verification section).

const BASE = 'https://banana-fantasy-sbs.vercel.app';
const TEST_USER = `test-firstpurchase-${Date.now()}`;

async function getPromos(userId: string) {
  const res = await fetch(`${BASE}/api/promos?userId=${encodeURIComponent(userId)}`);
  return res.json();
}

function getFirstPurchase(promos: any[]) {
  return promos.find((p: any) => p.type === 'first-purchase');
}

test.describe('First Purchase Bonus promo', () => {
  test('is seeded and served with the correct shape', async () => {
    const promos = await getPromos(TEST_USER);
    expect(Array.isArray(promos)).toBe(true);

    const promo = getFirstPurchase(promos);
    expect(promo, 'first-purchase promo should be seeded for every user').toBeTruthy();
    expect(promo.title).toContain('First Purchase');
    expect(promo.ctaLink).toBe('/buy-drafts');
    // Nothing earned yet on a fresh account.
    expect(promo.claimable).toBeFalsy();
    expect(promo.claimCount ?? 0).toBe(0);
    // Modal copy must explain the one-time / single-transaction rule.
    expect(String(promo.modalContent?.explanation ?? '')).toMatch(/first purchase/i);
  });
});
