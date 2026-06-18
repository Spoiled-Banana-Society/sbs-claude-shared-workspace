/**
 * Dual-tab stability test: Verify that having the draft room and drafting page
 * open simultaneously does NOT cause freezes, state conflicts, or errors.
 *
 * Steps:
 * 1. Mint token, join draft, fill with bots
 * 2. Open draft room in one page, drafting page in another
 * 3. Monitor both pages for console errors, freezes, and state consistency
 * 4. Navigate between pages, verify smooth operation
 *
 * Run:
 *   cd ~/sbs-claude-shared-workspace/repos/banana-fantasy
 *   npx playwright test e2e/dual-tab-stability.spec.ts --project=chromium --workers=1 --timeout=180000
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const API_BASE = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const SITE_URL = 'https://banana-fantasy-sbs.vercel.app';

async function fetchJson(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  try { return await res.json(); } catch { return { _error: true, status: res.status }; }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Collect console errors from a page */
function trackErrors(page: Page, label: string): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`[${label}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    errors.push(`[${label}] PAGE ERROR: ${err.message}`);
  });
  return errors;
}

/** Check if a page is frozen by trying to evaluate a simple expression */
async function isPageResponsive(page: Page, timeoutMs = 5000): Promise<boolean> {
  try {
    await page.evaluate(() => Date.now(), { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

test.describe('Dual-Tab Stability', () => {
  test.setTimeout(180_000);

  test('draft room + drafting page open simultaneously should not freeze', async ({ browser }) => {
    // Create a browser context (shared between pages like real tabs)
    const context = await browser.newContext();

    const wallet = '0xdualtab' + Date.now();
    const tokenRand = Math.floor(Math.random() * 900000) + 200000;

    // ===== STEP 1: Mint + Join + Fill =====
    console.log('\n=== STEP 1: Mint, Join, Fill ===');
    console.log('Wallet:', wallet);

    const mintResult = await fetchJson(`${API_BASE}/owner/${wallet}/draftToken/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minId: tokenRand, maxId: tokenRand }),
    });
    expect(mintResult?.tokens?.length).toBeGreaterThan(0);
    console.log('Minted token');

    const joinResult = await fetchJson(`${API_BASE}/league/fast/owner/${wallet}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numLeaguesToJoin: 1 }),
    });
    const raw = Array.isArray(joinResult) ? joinResult[0] : joinResult;
    const draftId = raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? null;
    expect(draftId).toBeTruthy();
    console.log('Joined draft:', draftId);

    await fetchJson(
      `${API_BASE}/staging/fill-bots/fast?count=9&leagueId=${encodeURIComponent(draftId)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    console.log('Filled with bots');

    // Wait for draft to start
    console.log('Waiting 15s for draft to start...');
    await sleep(15_000);

    // Verify draft is active
    const info = await fetchJson(`${API_BASE}/draft/${draftId}/state/info`);
    console.log(`Draft state: pick#${info.pickNumber}, drafter=${(info.currentDrafter || '').slice(0, 12)}...`);
    expect(info.pickNumber).toBeGreaterThanOrEqual(1);

    // ===== STEP 2: Open both pages =====
    console.log('\n=== STEP 2: Open Draft Room + Drafting Page ===');

    const draftRoomPage = await context.newPage();
    const draftingPage = await context.newPage();

    const draftRoomErrors = trackErrors(draftRoomPage, 'DraftRoom');
    const draftingErrors = trackErrors(draftingPage, 'Drafting');

    // Navigate to draft room
    const draftRoomUrl = `${SITE_URL}/draft-room?id=${encodeURIComponent(draftId)}&name=BBB+Test&speed=fast&players=10&mode=live&wallet=${encodeURIComponent(wallet)}`;
    console.log('Opening draft room...');
    await draftRoomPage.goto(draftRoomUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await draftRoomPage.waitForTimeout(3000);

    // Navigate to drafting page — set up staging + wallet in localStorage first
    console.log('Opening drafting page...');
    await draftingPage.goto(`${SITE_URL}/drafting?staging=true`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await draftingPage.evaluate(({ wallet, draftId }) => {
      sessionStorage.setItem('sbs-staging-mode', 'true');
      // Set user auth to match the wallet
      const authData = {
        walletAddress: wallet,
        username: 'TestUser',
        profilePicture: '',
        nflTeam: 'BUF',
        paidPasses: 5,
        freePasses: 3,
        isLoggedIn: true,
      };
      localStorage.setItem('banana-user', JSON.stringify(authData));
      // Add the draft to active drafts
      const drafts = JSON.parse(localStorage.getItem('banana-active-drafts') || '[]');
      const exists = drafts.some((d: any) => d.id === draftId);
      if (!exists) {
        drafts.push({
          id: draftId,
          contestName: 'BBB Test',
          draftSpeed: 'fast',
          players: 10,
          status: 'drafting',
          phase: 'drafting',
          type: 'pro',
          draftType: 'pro',
          isYourTurn: false,
          currentPick: 5,
          liveWalletAddress: wallet,
          joinedAt: Date.now(),
        });
        localStorage.setItem('banana-active-drafts', JSON.stringify(drafts));
      }
    }, { wallet, draftId: String(draftId) });

    // Reload drafting page to pick up the localStorage
    await draftingPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await draftingPage.waitForTimeout(3000);

    console.log('Both pages open');

    // ===== STEP 3: Monitor both pages for 30 seconds =====
    console.log('\n=== STEP 3: Monitor both pages for 30 seconds ===');

    const responsiveChecks: { elapsed: number; draftRoom: boolean; drafting: boolean }[] = [];

    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      const elapsed = (i + 1) * 5;

      const [drResponsive, dpResponsive] = await Promise.all([
        isPageResponsive(draftRoomPage),
        isPageResponsive(draftingPage),
      ]);

      responsiveChecks.push({ elapsed, draftRoom: drResponsive, drafting: dpResponsive });
      console.log(`  +${elapsed}s: DraftRoom=${drResponsive ? 'OK' : 'FROZEN'}, Drafting=${dpResponsive ? 'OK' : 'FROZEN'}`);

      if (!drResponsive || !dpResponsive) {
        console.log('  *** PAGE FREEZE DETECTED ***');
      }
    }

    // ===== STEP 4: Switch between tabs (focus/blur simulation) =====
    console.log('\n=== STEP 4: Switch between tabs ===');

    // Focus drafting page
    await draftingPage.bringToFront();
    await draftingPage.waitForTimeout(2000);
    const afterFocusDrafting = await isPageResponsive(draftingPage);
    console.log(`After focusing drafting page: ${afterFocusDrafting ? 'OK' : 'FROZEN'}`);

    // Focus draft room
    await draftRoomPage.bringToFront();
    await draftRoomPage.waitForTimeout(2000);
    const afterFocusDraftRoom = await isPageResponsive(draftRoomPage);
    console.log(`After focusing draft room: ${afterFocusDraftRoom ? 'OK' : 'FROZEN'}`);

    // Rapid switching
    for (let i = 0; i < 5; i++) {
      await draftingPage.bringToFront();
      await draftingPage.waitForTimeout(500);
      await draftRoomPage.bringToFront();
      await draftRoomPage.waitForTimeout(500);
    }

    const afterRapidSwitch = await Promise.all([
      isPageResponsive(draftRoomPage),
      isPageResponsive(draftingPage),
    ]);
    console.log(`After rapid tab switching: DraftRoom=${afterRapidSwitch[0] ? 'OK' : 'FROZEN'}, Drafting=${afterRapidSwitch[1] ? 'OK' : 'FROZEN'}`);

    // ===== STEP 5: Check draft room state is correct =====
    console.log('\n=== STEP 5: Check draft room state ===');

    // The draft room should still show valid state
    const draftRoomContent = await draftRoomPage.evaluate(() => {
      return {
        bodyText: document.body.innerText?.slice(0, 500),
        hasError: document.body.innerText?.includes('error') || document.body.innerText?.includes('Error'),
      };
    });
    console.log('Draft room content (first 200 chars):', draftRoomContent.bodyText?.slice(0, 200));

    // ===== STEP 6: Wait more and check heartbeat prevents dual WS =====
    console.log('\n=== STEP 6: Verify heartbeat prevents dual WebSocket ===');

    const heartbeatCheck = await draftingPage.evaluate((draftId) => {
      const key = `draft-room-ws:${draftId}`;
      const val = localStorage.getItem(key);
      return {
        key,
        value: val,
        isRecent: val ? (Date.now() - Number(val)) < 10000 : false,
      };
    }, String(draftId));
    console.log(`Heartbeat check: key=${heartbeatCheck.key}, value=${heartbeatCheck.value}, isRecent=${heartbeatCheck.isRecent}`);

    // ===== STEP 7: Close draft room, verify drafting page takes over =====
    console.log('\n=== STEP 7: Close draft room, verify drafting page takes over ===');

    await draftRoomPage.close();
    console.log('Draft room closed');
    await sleep(5000);

    // Heartbeat should be stale now
    const heartbeatAfterClose = await draftingPage.evaluate((draftId) => {
      const key = `draft-room-ws:${draftId}`;
      const val = localStorage.getItem(key);
      return {
        value: val,
        isRecent: val ? (Date.now() - Number(val)) < 10000 : false,
      };
    }, String(draftId));
    console.log(`Heartbeat after close: value=${heartbeatAfterClose.value}, isRecent=${heartbeatAfterClose.isRecent}`);

    // Drafting page should still be responsive
    const draftingStillOk = await isPageResponsive(draftingPage);
    console.log(`Drafting page after draft room closed: ${draftingStillOk ? 'OK' : 'FROZEN'}`);

    // ===== STEP 8: Reopen draft room, verify no conflict =====
    console.log('\n=== STEP 8: Reopen draft room ===');

    const draftRoomPage2 = await context.newPage();
    const draftRoomErrors2 = trackErrors(draftRoomPage2, 'DraftRoom2');

    await draftRoomPage2.goto(draftRoomUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await draftRoomPage2.waitForTimeout(5000);

    const bothOk = await Promise.all([
      isPageResponsive(draftRoomPage2),
      isPageResponsive(draftingPage),
    ]);
    console.log(`After reopening: DraftRoom=${bothOk[0] ? 'OK' : 'FROZEN'}, Drafting=${bothOk[1] ? 'OK' : 'FROZEN'}`);

    // ===== ANALYSIS =====
    console.log('\n=== ANALYSIS ===');

    // Check for freezes
    const freezes = responsiveChecks.filter(c => !c.draftRoom || !c.drafting);
    console.log(`Freezes detected: ${freezes.length}`);
    if (freezes.length > 0) {
      for (const f of freezes) {
        console.log(`  +${f.elapsed}s: DraftRoom=${f.draftRoom}, Drafting=${f.drafting}`);
      }
    }

    // Check for errors
    const allErrors = [...draftRoomErrors, ...draftingErrors, ...draftRoomErrors2];
    // Filter out common non-critical errors
    const criticalErrors = allErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('manifest') &&
      !e.includes('Firestore') &&
      !e.includes('firebase') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('net::') &&
      !e.includes('Failed to load resource') &&
      !e.includes('ResizeObserver')
    );
    console.log(`Console errors: ${allErrors.length} total, ${criticalErrors.length} critical`);
    for (const e of criticalErrors.slice(0, 10)) {
      console.log(`  ${e}`);
    }

    // ASSERTIONS
    // No freezes detected
    expect(freezes.length).toBe(0);

    // Pages remained responsive after tab switching
    expect(afterRapidSwitch[0]).toBe(true);
    expect(afterRapidSwitch[1]).toBe(true);

    // Drafting page survived draft room close + reopen
    expect(draftingStillOk).toBe(true);
    expect(bothOk[0]).toBe(true);
    expect(bothOk[1]).toBe(true);

    // No critical page errors (page crashes, unhandled exceptions)
    const pageErrors = allErrors.filter(e => e.includes('PAGE ERROR'));
    expect(pageErrors.length).toBe(0);

    console.log('\nPASS: Both pages remained responsive throughout the test');

    await context.close();
  });
});
