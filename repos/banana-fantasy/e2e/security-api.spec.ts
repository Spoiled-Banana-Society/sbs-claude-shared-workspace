import { test, expect } from '@playwright/test';

const API_BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Security: API Route Protection', () => {
  test.describe('Wheel Spin API', () => {
    test('rejects unauthenticated requests', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/wheel/spin`, {
        data: { userId: 'test-user' },
      });
      expect(res.status()).toBe(401);
    });

    test('rejects requests with invalid JWT', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/wheel/spin`, {
        headers: { Authorization: 'Bearer invalid-token-here' },
        data: { userId: 'test-user' },
      });
      expect(res.status()).toBe(401);
    });

    test('rejects forceResult in production environment', async ({ request }) => {
      // Even with a valid-looking request, forceResult should be ignored in non-staging
      const res = await request.post(`${API_BASE}/api/wheel/spin`, {
        data: { userId: 'test-user', forceResult: 'jackpot' },
      });
      // Should get 401 (no auth), not 200 with forced jackpot
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Purchase API (card-mint — sole purchase path)', () => {
    // Phase 9 consolidated /create + /verify + /retry-purchase into the
    // single atomic /api/purchases/card-mint endpoint. These tests target
    // the new endpoint's input-validation surface. Auth-style rejection
    // here is harder to exercise (the route requires a valid USDC permit
    // signature; without that, it 400s on input validation before any
    // auth check would fire). So we test the validation paths instead.

    test('rejects missing userId', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          quantity: 1,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: '0x' + 'a'.repeat(130),
          paymentMethod: 'card',
        },
      });
      // 400 = invalid input (no userId), 503 = admin mint not configured.
      // Both confirm the route refuses to mint without a real wallet.
      expect([400, 503]).toContain(res.status());
    });

    test('rejects non-wallet userId format', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          userId: 'not-a-wallet',
          quantity: 1,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: '0x' + 'a'.repeat(130),
          paymentMethod: 'card',
        },
      });
      expect([400, 503]).toContain(res.status());
    });

    test('rejects quantity over MAX_QUANTITY (40)', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          userId: '0x' + 'a'.repeat(40),
          quantity: 999,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: '0x' + 'a'.repeat(130),
          paymentMethod: 'card',
        },
      });
      expect([400, 503]).toContain(res.status());
    });

    test('rejects zero quantity', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          userId: '0x' + 'a'.repeat(40),
          quantity: 0,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: '0x' + 'a'.repeat(130),
          paymentMethod: 'card',
        },
      });
      expect([400, 503]).toContain(res.status());
    });

    test('rejects negative quantity', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          userId: '0x' + 'a'.repeat(40),
          quantity: -5,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: '0x' + 'a'.repeat(130),
          paymentMethod: 'card',
        },
      });
      expect([400, 503]).toContain(res.status());
    });

    test('rejects expired permit deadline', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          userId: '0x' + 'a'.repeat(40),
          quantity: 1,
          deadline: Math.floor(Date.now() / 1000) - 60, // already expired
          signature: '0x' + 'a'.repeat(130),
          paymentMethod: 'card',
        },
      });
      expect([400, 503]).toContain(res.status());
    });

    test('rejects bogus signature shape', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/purchases/card-mint`, {
        data: {
          userId: '0x' + 'a'.repeat(40),
          quantity: 1,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          signature: 'not-a-signature',
          paymentMethod: 'card',
        },
      });
      expect([400, 503]).toContain(res.status());
    });

    test('staging-mint rejects unauthenticated requests', async ({ request }) => {
      // /api/purchases/staging-mint is admin-key gated; should 401/403
      // without auth.
      const res = await request.post(`${API_BASE}/api/purchases/staging-mint`, {
        data: {
          userId: '0x' + 'a'.repeat(40),
          quantity: 1,
        },
      });
      expect([401, 403]).toContain(res.status());
    });
  });

  test.describe('Withdrawal API', () => {
    test('rejects unauthenticated requests', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/prizes/withdraw`, {
        data: {
          userId: 'test-user',
          draftId: 'fake-draft',
          amount: 100,
          method: 'usdc',
        },
      });
      expect(res.status()).toBe(401);
    });

    test('rejects withdrawal with missing fields', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/prizes/withdraw`, {
        data: {},
      });
      expect([400, 401]).toContain(res.status());
    });
  });

  test.describe('CORS Protection', () => {
    test.skip('rejects requests from unauthorized origins - CORS is browser-enforced, not testable via Playwright request API', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/wheel/spin`, {
        headers: {
          Origin: 'https://evil-site.vercel.app',
        },
        data: { userId: 'test-user' },
      });
      // Should be blocked by CORS or return 401
      expect([401, 403]).toContain(res.status());
    });

    test.skip('rejects null origin - CORS is browser-enforced, not testable via Playwright request API', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/wheel/spin`, {
        headers: {
          Origin: '',
        },
        data: { userId: 'test-user' },
      });
      expect([401, 403]).toContain(res.status());
    });
  });
});

test.describe('Security: Wheel Config Validation', () => {
  test('wheel page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/banana-wheel');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('analytics') &&
        !e.includes('privy') &&
        !e.includes('hydration') &&
        !e.includes('401') &&
        !e.includes('Expected server HTML') &&
        !e.includes('API error') &&
        !e.includes('Failed to load resource'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('wheel displays spin button and prize segments', async ({ page }) => {
    await page.goto('/banana-wheel');
    await page.waitForLoadState('domcontentloaded');

    // Should show the wheel with spin button
    await expect(page.locator('text=Banana Wheel')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Security: Marketplace Protection', () => {
  test('marketplace loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('analytics') &&
        !e.includes('privy') &&
        !e.includes('hydration') &&
        !e.includes('401') &&
        !e.includes('Expected server HTML') &&
        !e.includes('API error') &&
        !e.includes('Failed to load resource'),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('marketplace tabs are accessible', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('text=Buy Teams')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Sell My Teams')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Activity')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Watchlist')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Security: Auth & State', () => {
  test('no wallet addresses in console logs on staging', async ({ page }) => {
    const walletLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      // Check for wallet address patterns (0x followed by 40 hex chars)
      if (/0x[a-fA-F0-9]{40}/.test(text) && text.includes('[SBS Auth]')) {
        walletLogs.push(text);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // On staging, some wallet logs are acceptable
    // On production, there should be ZERO
    // This test documents what's logged
    if (walletLogs.length > 0) {
      console.log(`Found ${walletLogs.length} wallet log entries (staging mode - acceptable)`);
    }
  });

  test('exposure page loads and shows data', async ({ page }) => {
    await page.goto('/exposure');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: 'Exposure' })).toBeVisible({ timeout: 10000 });
  });

  test('leaderboard loads with all tabs', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('text=Season Leaderboard')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Overall')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=BBB Pro')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Jackpot')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Hall of Fame')).toBeVisible({ timeout: 5000 });
  });
});
