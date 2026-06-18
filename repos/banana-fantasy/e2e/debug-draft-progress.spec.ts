/**
 * Debug script: Investigate whether the staging backend auto-advances picks
 * after a draft starts.
 *
 * Steps:
 * 1. Hit the staging API directly to join a draft + fill with bots
 * 2. Poll /draft/{draftId}/state/info every 10s for ~90s
 * 3. Log pickNumber, currentDrafter, draftStartTime on each poll
 * 4. Report whether picks advanced or stayed stuck
 *
 * Run:
 *   cd ~/sbs-claude-shared-workspace/repos/banana-fantasy
 *   npx playwright test e2e/debug-draft-progress.spec.ts --project=chromium --workers=1 --timeout=180000
 */

import { test, expect } from '@playwright/test';

const API_BASE = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const WS_BASE = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';
const SITE_URL = 'https://banana-fantasy-sbs.vercel.app';
const TEST_WALLET = '0x0000000000000000000000000000000000000001';

interface DraftInfo {
  draftId?: string;
  displayName?: string;
  draftStartTime?: number;
  currentPickEndTime?: number;
  currentDrafter?: string;
  pickNumber?: number;
  roundNum?: number;
  pickInRound?: number;
  pickLength?: number;
  draftOrder?: Array<{ ownerId: string; tokenId: string }>;
  [k: string]: unknown;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    console.log(`[API ${res.status}] ${init?.method || 'GET'} ${url}`);
    if (text.length < 2000) console.log(`  Response: ${text}`);
    else console.log(`  Response (truncated): ${text.slice(0, 2000)}...`);
    if (!res.ok) return { _error: true, status: res.status, body: text };
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(timeout);
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test.describe('Debug: Draft Pick Advancement', () => {
  test.setTimeout(180_000); // 3 minutes

  test('investigate whether server auto-advances picks after draft starts', async ({ page }) => {
    const results: {
      timestamp: number;
      elapsed: number;
      pickNumber?: number;
      roundNum?: number;
      currentDrafter?: string;
      draftStartTime?: number;
      currentPickEndTime?: number;
      pickLength?: number;
    }[] = [];

    // ===== STEP 1: Check site and localStorage for existing drafts =====
    console.log('\n========================================');
    console.log('STEP 1: Navigate to staging site');
    console.log('========================================\n');

    await page.goto(`${SITE_URL}/?staging=true`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      sessionStorage.setItem('sbs-staging-mode', 'true');
    });
    await page.waitForTimeout(2000);

    // Check localStorage for existing active drafts
    const existingDrafts = await page.evaluate(() => {
      const raw = localStorage.getItem('banana-active-drafts');
      return raw ? raw : null;
    });
    console.log(`\nExisting active drafts in localStorage: ${existingDrafts || 'NONE'}`);

    // ===== STEP 2: Try to find or create a draft via API =====
    console.log('\n========================================');
    console.log('STEP 2: Join a draft via the staging API');
    console.log('========================================\n');

    // First, mint a staging pass so we can join
    console.log('Minting staging pass...');
    await fetchJson(`${API_BASE}/staging/mint/${TEST_WALLET}/1`, { method: 'POST' });

    // Join a fast draft
    console.log('Joining a fast draft...');
    const joinResult = await fetchJson(`${API_BASE}/league/fast/owner/${TEST_WALLET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numLeaguesToJoin: 1 }),
    });

    let draftId: string | null = null;
    if (joinResult && !joinResult._error) {
      const raw = Array.isArray(joinResult) ? joinResult[0] : joinResult;
      draftId = raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? raw?.id ?? null;
      if (draftId) draftId = String(draftId);
    }

    if (!draftId) {
      console.log('ERROR: Could not join a draft. Join result:', JSON.stringify(joinResult));
      // Try getting drafts for this wallet instead
      console.log('Trying to fetch existing drafts for wallet...');
      const ownerDrafts = await fetchJson(`${API_BASE}/owner/${TEST_WALLET}/draftTokens`);
      console.log('Owner draft tokens:', JSON.stringify(ownerDrafts)?.slice(0, 2000));
      expect(draftId).toBeTruthy();
      return;
    }

    console.log(`\nJoined draft: ${draftId}`);

    // ===== STEP 3: Check initial draft state =====
    console.log('\n========================================');
    console.log('STEP 3: Check initial draft state');
    console.log('========================================\n');

    const initialInfo = await fetchJson(`${API_BASE}/draft/${draftId}/state/info`) as DraftInfo;
    console.log('\nInitial draft info:');
    console.log(`  draftId: ${initialInfo.draftId}`);
    console.log(`  displayName: ${initialInfo.displayName}`);
    console.log(`  draftStartTime: ${initialInfo.draftStartTime}`);
    console.log(`  currentDrafter: ${initialInfo.currentDrafter}`);
    console.log(`  pickNumber: ${initialInfo.pickNumber}`);
    console.log(`  roundNum: ${initialInfo.roundNum}`);
    console.log(`  pickLength: ${initialInfo.pickLength}`);
    console.log(`  draftOrder length: ${initialInfo.draftOrder?.length}`);

    // ===== STEP 4: Fill with bots =====
    console.log('\n========================================');
    console.log('STEP 4: Fill draft with bots');
    console.log('========================================\n');

    console.log('Calling staging/fill-bots/fast with leagueId...');
    const fillResult = await fetchJson(
      `${API_BASE}/staging/fill-bots/fast?count=9&leagueId=${encodeURIComponent(draftId)}`,
      { method: 'POST' }
    );
    console.log('Fill result:', JSON.stringify(fillResult)?.slice(0, 1000));

    // Wait a few seconds for the draft to start
    console.log('\nWaiting 10 seconds for draft to potentially start...');
    await sleep(10_000);

    // ===== STEP 5: Check state after filling =====
    console.log('\n========================================');
    console.log('STEP 5: Check state after bot fill');
    console.log('========================================\n');

    const afterFillInfo = await fetchJson(`${API_BASE}/draft/${draftId}/state/info`) as DraftInfo;
    console.log('After-fill draft info:');
    console.log(`  draftStartTime: ${afterFillInfo.draftStartTime} (${afterFillInfo.draftStartTime ? new Date(afterFillInfo.draftStartTime).toISOString() : 'not set'})`);
    console.log(`  currentDrafter: ${afterFillInfo.currentDrafter}`);
    console.log(`  pickNumber: ${afterFillInfo.pickNumber}`);
    console.log(`  roundNum: ${afterFillInfo.roundNum}`);
    console.log(`  pickLength: ${afterFillInfo.pickLength}`);
    console.log(`  currentPickEndTime: ${afterFillInfo.currentPickEndTime} (${afterFillInfo.currentPickEndTime ? new Date(afterFillInfo.currentPickEndTime).toISOString() : 'not set'})`);
    console.log(`  draftOrder: ${JSON.stringify(afterFillInfo.draftOrder)?.slice(0, 500)}`);

    const draftHasStarted = !!(afterFillInfo.draftStartTime && afterFillInfo.draftStartTime <= Date.now());
    console.log(`\nDraft started? ${draftHasStarted}`);
    if (afterFillInfo.draftStartTime) {
      console.log(`  Start time: ${new Date(afterFillInfo.draftStartTime).toISOString()}`);
      console.log(`  Now: ${new Date().toISOString()}`);
      console.log(`  Diff: ${Date.now() - afterFillInfo.draftStartTime}ms`);
    }

    // ===== STEP 6: Poll draft state every 10 seconds for 90 seconds =====
    console.log('\n========================================');
    console.log('STEP 6: Poll draft state over ~90 seconds');
    console.log('========================================\n');

    const pollStart = Date.now();
    const POLL_INTERVAL = 10_000; // 10 seconds
    const POLL_DURATION = 90_000; // 90 seconds total
    let pollCount = 0;

    while (Date.now() - pollStart < POLL_DURATION) {
      pollCount++;
      const elapsed = Date.now() - pollStart;
      const info = await fetchJson(`${API_BASE}/draft/${draftId}/state/info`) as DraftInfo;

      const entry = {
        timestamp: Date.now(),
        elapsed: Math.round(elapsed / 1000),
        pickNumber: info.pickNumber,
        roundNum: info.roundNum,
        currentDrafter: info.currentDrafter,
        draftStartTime: info.draftStartTime,
        currentPickEndTime: info.currentPickEndTime,
        pickLength: info.pickLength,
      };
      results.push(entry);

      console.log(`\n--- Poll #${pollCount} (${Math.round(elapsed / 1000)}s elapsed) ---`);
      console.log(`  pickNumber: ${info.pickNumber}`);
      console.log(`  roundNum: ${info.roundNum}`);
      console.log(`  currentDrafter: ${info.currentDrafter}`);
      console.log(`  currentPickEndTime: ${info.currentPickEndTime ? new Date(info.currentPickEndTime).toISOString() : 'not set'}`);

      // Check if pick timer has expired
      if (info.currentPickEndTime) {
        const timeLeft = info.currentPickEndTime - Date.now();
        console.log(`  Time left on pick: ${Math.round(timeLeft / 1000)}s`);
        if (timeLeft < 0) {
          console.log(`  *** PICK TIMER EXPIRED ${Math.round(-timeLeft / 1000)}s AGO ***`);
        }
      }

      if (pollCount >= 2) {
        const prev = results[results.length - 2];
        const curr = results[results.length - 1];
        if (prev.pickNumber !== curr.pickNumber) {
          console.log(`  >>> PICK ADVANCED: ${prev.pickNumber} -> ${curr.pickNumber} <<<`);
        } else {
          console.log(`  --- Pick NOT advancing (still at ${curr.pickNumber}) ---`);
        }
      }

      await sleep(POLL_INTERVAL);
    }

    // ===== STEP 7: Also try connecting WebSocket to see if that triggers advancement =====
    console.log('\n========================================');
    console.log('STEP 7: Try WebSocket connection to see if it triggers picks');
    console.log('========================================\n');

    // Use the browser page to open a WebSocket connection
    const wsMessages = await page.evaluate(async ({ wsBase, wallet, draftId }) => {
      const messages: string[] = [];
      return new Promise<string[]>((resolve) => {
        try {
          const wsUrl = `${wsBase}/ws?address=${wallet}&draftName=${draftId}`;
          messages.push(`Connecting to: ${wsUrl}`);
          const ws = new WebSocket(wsUrl);

          ws.onopen = () => {
            messages.push('WebSocket CONNECTED');
          };

          ws.onmessage = (event) => {
            messages.push(`WS MSG: ${typeof event.data === 'string' ? event.data.slice(0, 500) : 'binary'}`);
          };

          ws.onerror = (event) => {
            messages.push(`WS ERROR: ${JSON.stringify(event)}`);
          };

          ws.onclose = (event) => {
            messages.push(`WS CLOSED: code=${event.code} reason=${event.reason}`);
          };

          // Listen for 30 seconds, then close and return messages
          setTimeout(() => {
            messages.push('Closing WebSocket after 30s observation');
            try { ws.close(); } catch {}
            resolve(messages);
          }, 30000);
        } catch (err) {
          messages.push(`WS INIT ERROR: ${err}`);
          resolve(messages);
        }
      });
    }, { wsBase: WS_BASE, wallet: TEST_WALLET, draftId });

    console.log('\nWebSocket messages received:');
    for (const msg of wsMessages) {
      console.log(`  ${msg}`);
    }

    // ===== STEP 8: Final poll after WebSocket connection =====
    console.log('\n========================================');
    console.log('STEP 8: Final poll after WebSocket connection');
    console.log('========================================\n');

    const finalInfo = await fetchJson(`${API_BASE}/draft/${draftId}/state/info`) as DraftInfo;
    console.log('Final draft info:');
    console.log(`  pickNumber: ${finalInfo.pickNumber}`);
    console.log(`  roundNum: ${finalInfo.roundNum}`);
    console.log(`  currentDrafter: ${finalInfo.currentDrafter}`);
    console.log(`  currentPickEndTime: ${finalInfo.currentPickEndTime ? new Date(finalInfo.currentPickEndTime).toISOString() : 'not set'}`);

    results.push({
      timestamp: Date.now(),
      elapsed: Math.round((Date.now() - pollStart) / 1000),
      pickNumber: finalInfo.pickNumber,
      roundNum: finalInfo.roundNum,
      currentDrafter: finalInfo.currentDrafter,
      draftStartTime: finalInfo.draftStartTime,
      currentPickEndTime: finalInfo.currentPickEndTime,
      pickLength: finalInfo.pickLength,
    });

    // ===== STEP 9: Also check /draft/{draftId}/state/summary to see if any picks were made =====
    console.log('\n========================================');
    console.log('STEP 9: Check draft summary for picks');
    console.log('========================================\n');

    const summary = await fetchJson(`${API_BASE}/draft/${draftId}/state/summary`);
    if (Array.isArray(summary)) {
      console.log(`Total picks in summary: ${summary.length}`);
      for (const pick of summary.slice(0, 10)) {
        const p = pick?.playerInfo || pick;
        console.log(`  Pick #${p?.pickNum}: ${p?.displayName || p?.playerId} (${p?.team} ${p?.position}) by ${p?.ownerAddress?.slice(0, 10)}...`);
      }
    } else {
      console.log('Summary response:', JSON.stringify(summary)?.slice(0, 1000));
    }

    // ===== ANALYSIS =====
    console.log('\n========================================');
    console.log('ANALYSIS');
    console.log('========================================\n');

    const pickNumbers = results.map(r => r.pickNumber).filter(n => n !== undefined);
    const uniquePicks = [...new Set(pickNumbers)];
    const firstPick = pickNumbers[0];
    const lastPick = pickNumbers[pickNumbers.length - 1];

    console.log(`Poll results over ${results[results.length - 1]?.elapsed}s:`);
    console.log(`  First pickNumber: ${firstPick}`);
    console.log(`  Last pickNumber: ${lastPick}`);
    console.log(`  Unique pick numbers seen: ${JSON.stringify(uniquePicks)}`);
    console.log(`  Total polls: ${results.length}`);

    if (uniquePicks.length <= 1) {
      console.log('\n*** CONCLUSION: pickNumber DID NOT CHANGE ***');
      console.log('The server is NOT auto-advancing picks.');
      console.log('This means bots do NOT auto-pick on their own.');
      console.log('The server likely requires a WebSocket client connection');
      console.log('or some other trigger to advance picks.');

      // Check if the timer expired
      const lastEntry = results[results.length - 1];
      if (lastEntry.currentPickEndTime) {
        const expired = Date.now() - lastEntry.currentPickEndTime;
        if (expired > 0) {
          console.log(`\nThe pick timer expired ${Math.round(expired / 1000)}s ago.`);
          console.log('Even with an expired timer, the server did not advance.');
          console.log('This is likely the root cause of the bug.');
        }
      }
    } else {
      console.log('\n*** CONCLUSION: pickNumber DID change ***');
      console.log(`Picks advanced from ${firstPick} to ${lastPick}.`);
      console.log('The server IS auto-advancing picks (bots auto-pick).');
    }

    console.log('\nFull poll timeline:');
    for (const r of results) {
      console.log(`  +${r.elapsed}s: pick=${r.pickNumber} round=${r.roundNum} drafter=${r.currentDrafter?.slice(0, 15)}... pickEnd=${r.currentPickEndTime ? new Date(r.currentPickEndTime).toISOString() : 'n/a'}`);
    }

    // The test always passes — this is a diagnostic tool
    expect(true).toBe(true);
  });
});
