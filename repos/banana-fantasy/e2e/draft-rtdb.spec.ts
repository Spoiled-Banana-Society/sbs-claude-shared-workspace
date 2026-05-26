import { test, expect, type ConsoleMessage } from '@playwright/test';

/**
 * Smoke coverage for the Firebase-RTDB / no-WS transport.
 *
 * These tests load the draft room with the same URL shapes the live app uses
 * for both fast and slow drafts and assert:
 *   - The page renders
 *   - No client code attempts a WebSocket connection to sbs-drafts-server*
 *   - No critical console errors fire on load
 *
 * Full end-to-end pick flow is covered by manual staging dry-runs (plan §7).
 */

const BENIGN = [
  'favicon',
  'analytics',
  'privy',
  'hydration',
  'Expected server HTML',
  'ResizeObserver',
  'AudioContext',
  'API error',
  'Failed to load resource',
  'cannot be a descendant',
];

function collectConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function critical(errors: string[]): string[] {
  return errors.filter((e) => !BENIGN.some((b) => e.includes(b)));
}

test.describe('Draft transport — Firebase RTDB (WS disabled)', () => {
  test('fast draft room loads and shows contest name', async ({ page }) => {
    await page.goto('/draft-room?name=BBB+%23300&players=1&speed=fast');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=BBB #300')).toBeVisible({ timeout: 10000 });
  });

  test('slow draft room loads and shows contest name', async ({ page }) => {
    await page.goto('/draft-room?name=BBB+%23301&players=1&speed=slow');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=BBB #301')).toBeVisible({ timeout: 10000 });
  });

  test('does not open a WebSocket to the retired sbs-drafts-server', async ({ page }) => {
    const wsUrls: string[] = [];
    page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
    });

    await page.goto('/draft-room?name=BBB+%23302&players=1&speed=fast&mode=live&wallet=0xTestWalletRtdb');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const draftServerWs = wsUrls.filter((u) => u.includes('sbs-drafts-server'));
    expect(draftServerWs, `unexpected WS connections: ${draftServerWs.join(', ')}`).toHaveLength(0);
  });

  test('no critical console errors on fast draft load', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/draft-room?name=BBB+%23303&players=1&speed=fast');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    expect(critical(errors)).toHaveLength(0);
  });

  test('no critical console errors on slow draft load', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/draft-room?name=BBB+%23304&players=1&speed=slow');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    expect(critical(errors)).toHaveLength(0);
  });

});
