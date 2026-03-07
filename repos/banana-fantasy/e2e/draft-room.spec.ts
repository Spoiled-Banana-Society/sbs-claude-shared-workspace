import { test, expect } from '@playwright/test';

test.describe('Draft Room', () => {
  test.describe('Fresh entry (no stored state)', () => {
    test('renders filling phase with correct contest name', async ({ page }) => {
      await page.goto('/draft-room?name=BBB+%23200&players=1&speed=fast');
      await page.waitForLoadState('domcontentloaded');

      // Should show the contest name in the top bar
      await expect(page.locator('text=BBB #200')).toBeVisible({ timeout: 10000 });
    });

    test('shows UNREVEALED badge during filling', async ({ page }) => {
      await page.goto('/draft-room?name=BBB+%23200&players=1&speed=fast');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('text=UNREVEALED')).toBeVisible({ timeout: 10000 });
    });

    test('shows player slots during filling', async ({ page }) => {
      await page.goto('/draft-room?name=BBB+%23200&players=3&speed=fast');
      await page.waitForLoadState('domcontentloaded');

      // Should show the filling UI with player emoji slots visible
      const body = page.locator('body');
      await expect(body).toBeVisible({ timeout: 10000 });
      // The banner should render 10 boxes for players (pre-engine mode)
      const profileImages = page.locator('img[alt="Banana"]');
      await expect(profileImages.first()).toBeVisible({ timeout: 10000 });
    });

    test('has no critical console errors on load', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      await page.goto('/draft-room?name=BBB+%23200&players=1&speed=fast');
      await page.waitForLoadState('domcontentloaded');
      // Wait for initial render and any console errors to fire
      await page.waitForTimeout(3000);

      // Filter out known benign errors (hydration warnings, third-party, etc.)
      const criticalErrors = errors.filter(
        (e) =>
          !e.includes('favicon') &&
          !e.includes('analytics') &&
          !e.includes('privy') &&
          !e.includes('hydration') &&
          !e.includes('Expected server HTML') &&
          !e.includes('ResizeObserver') &&
          !e.includes('AudioContext') &&
          !e.includes('API error'),
      );
      expect(criticalErrors).toHaveLength(0);
    });
  });

  test.describe('Re-entry with stored state (loading phase)', () => {
    test('enters loading phase when stored state indicates drafting', async ({ page }) => {
      // Set up localStorage with a stored draft that's in 'drafting' phase
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const storedDraft = {
          id: 'test-reentry-draft-123',
          contestName: 'BBB #999',
          status: 'drafting',
          type: 'pro',
          draftSpeed: 'fast',
          players: 10,
          maxPlayers: 10,
          phase: 'drafting',
          draftType: 'pro',
          lastUpdated: Date.now(),
          liveWalletAddress: '0xTestWallet123',
          draftOrder: [
            { id: '1', name: '0xTestWallet123', displayName: 'You', isYou: true, avatar: '🍌' },
            { id: '2', name: '0xBot1', displayName: '0xBot1...', isYou: false, avatar: '🍌' },
          ],
        };
        localStorage.setItem('banana-active-drafts', JSON.stringify([storedDraft]));
      });

      // Navigate to draft room with live mode params matching stored draft
      await page.goto(
        '/draft-room?id=test-reentry-draft-123&name=BBB+%23999&speed=fast&mode=live&wallet=0xTestWallet123',
      );
      await page.waitForLoadState('domcontentloaded');

      // Contest name and PRO badge should be visible (shown in both loading and drafting states)
      await expect(page.locator('text=BBB #999')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=PRO')).toBeVisible({ timeout: 10000 });

      // Should NOT replay randomizing animation on re-entry
      const randomizing = page.locator('text=RANDOMIZING DRAFT ORDER');
      await expect(randomizing).not.toBeVisible();
    });

    test('shows loading spinner when stored state indicates pre-spin', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const storedDraft = {
          id: 'test-prespin-draft-456',
          contestName: 'BBB #888',
          status: 'filling',
          type: null,
          draftSpeed: 'fast',
          players: 10,
          maxPlayers: 10,
          phase: 'pre-spin',
          preSpinStartedAt: Date.now() - 5000, // 5 seconds ago
          lastUpdated: Date.now(),
          liveWalletAddress: '0xTestWallet456',
        };
        localStorage.setItem('banana-active-drafts', JSON.stringify([storedDraft]));
      });

      await page.goto(
        '/draft-room?id=test-prespin-draft-456&name=BBB+%23888&speed=fast&mode=live&wallet=0xTestWallet456',
      );
      await page.waitForLoadState('domcontentloaded');

      // Should show loading spinner instead of RANDOMIZING animation
      await expect(page.locator('text=Reconnecting to draft...')).toBeVisible({ timeout: 5000 });
    });

    test('does NOT show RANDOMIZING DRAFT ORDER on re-entry', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const storedDraft = {
          id: 'test-no-randomize-789',
          contestName: 'BBB #777',
          status: 'drafting',
          type: 'pro',
          draftSpeed: 'fast',
          players: 10,
          maxPlayers: 10,
          phase: 'drafting',
          draftType: 'pro',
          lastUpdated: Date.now(),
          liveWalletAddress: '0xTestWallet789',
        };
        localStorage.setItem('banana-active-drafts', JSON.stringify([storedDraft]));
      });

      await page.goto(
        '/draft-room?id=test-no-randomize-789&name=BBB+%23777&speed=fast&mode=live&wallet=0xTestWallet789',
      );
      await page.waitForLoadState('domcontentloaded');

      // Wait a bit for any animations to potentially start
      await page.waitForTimeout(2000);

      // RANDOMIZING DRAFT ORDER text should NOT be visible
      const randomizing = page.locator('text=RANDOMIZING DRAFT ORDER');
      await expect(randomizing).not.toBeVisible();
    });
  });

  test.describe('Local mode (no live server)', () => {
    test('filling phase counts up to 10 players then transitions', async ({ page }) => {
      await page.goto('/draft-room?name=BBB+%23300&players=1&speed=fast');
      await page.waitForLoadState('domcontentloaded');

      // Wait for filling animation to progress — should reach 10/10
      // The filling animation adds 1 player every 800ms, so 9 players * 800ms = ~7.2s
      // After 10/10, local mode transitions directly to pre-spin
      // Pre-spin shows "Draft type reveal in Xs"
      await expect(page.locator('text=/Draft type reveal in/')).toBeVisible({ timeout: 15000 });
    });

    test('starts with correct initial player count and transitions faster', async ({ page }) => {
      await page.goto('/draft-room?name=BBB+%23300&players=7&speed=fast');
      await page.waitForLoadState('domcontentloaded');

      // Starting at 7 players, should reach 10 faster (3 * 800ms = ~2.4s)
      // Then transitions to pre-spin with "Draft type reveal in Xs"
      await expect(page.locator('text=/Draft type reveal in/')).toBeVisible({ timeout: 10000 });
    });
  });
});

test.describe('Drafting Page', () => {
  test('loads successfully', async ({ page }) => {
    await page.goto('/drafting');
    await page.waitForLoadState('domcontentloaded');

    // Should have some visible content
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('shows draft entries from localStorage', async ({ page }) => {
    // Seed localStorage with a test draft
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      const testDraft = {
        id: 'test-draft-list-001',
        contestName: 'BBB #500',
        status: 'drafting',
        type: 'pro',
        draftSpeed: 'fast',
        players: 10,
        maxPlayers: 10,
        phase: 'drafting',
        draftType: 'pro',
        currentPick: 3,
        isYourTurn: false,
        lastUpdated: Date.now(),
      };
      localStorage.setItem('banana-active-drafts', JSON.stringify([testDraft]));
    });

    await page.goto('/drafting');
    await page.waitForLoadState('domcontentloaded');

    // Should show the draft entry
    await expect(page.locator('text=BBB #500')).toBeVisible({ timeout: 10000 });
  });

  test('shows picks away for in-progress drafts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      const testDraft = {
        id: 'test-picks-away-002',
        contestName: 'BBB #501',
        status: 'drafting',
        type: 'pro',
        draftSpeed: 'fast',
        players: 10,
        maxPlayers: 10,
        phase: 'drafting',
        draftType: 'pro',
        currentPick: 5,
        isYourTurn: false,
        lastUpdated: Date.now(),
      };
      localStorage.setItem('banana-active-drafts', JSON.stringify([testDraft]));
    });

    await page.goto('/drafting');
    await page.waitForLoadState('domcontentloaded');

    // Should show "5 picks away" text
    await expect(page.locator('text=5 picks away')).toBeVisible({ timeout: 10000 });
  });

  test('shows your turn indicator', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      const testDraft = {
        id: 'test-your-turn-003',
        contestName: 'BBB #502',
        status: 'drafting',
        type: 'pro',
        draftSpeed: 'fast',
        players: 10,
        maxPlayers: 10,
        phase: 'drafting',
        draftType: 'pro',
        currentPick: 0,
        isYourTurn: true,
        timeRemaining: 25,
        lastUpdated: Date.now(),
      };
      localStorage.setItem('banana-active-drafts', JSON.stringify([testDraft]));
    });

    await page.goto('/drafting');
    await page.waitForLoadState('domcontentloaded');

    // Should show "Pick Now" button for your turn drafts
    await expect(page.locator('text=Pick Now')).toBeVisible({ timeout: 10000 });
  });

  test('clears drafts when localStorage is empty', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      localStorage.removeItem('banana-active-drafts');
    });

    await page.goto('/drafting');
    await page.waitForLoadState('domcontentloaded');

    // Should show empty state or demo drafts only
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
