/**
 * Test: Verify the WebSocket keepalive provides working countdown data.
 *
 * 1. Mint token (proper endpoint), join draft, fill with bots
 * 2. Open WebSocket connection (same as drafting page keepalive)
 * 3. Collect timer_update and draft_info_update events
 * 4. Verify timer counts DOWN and picks advance
 */
import { test, expect } from '@playwright/test';

const API_BASE = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const WS_BASE = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';

async function fetchJson(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  try { return await res.json(); } catch { return { _error: true, status: res.status }; }
}

test('WebSocket timer counts down and picks advance', async ({ page }) => {
  test.setTimeout(180_000);

  const wallet = '0xtimertst' + Date.now();
  const tokenRand = Math.floor(Math.random() * 900000) + 200000;

  // 1. Mint token (correct endpoint: /owner/{wallet}/draftToken/mint with minId/maxId)
  console.log('Minting for', wallet, 'tokenId range:', tokenRand);
  const mintResult = await fetchJson(`${API_BASE}/owner/${wallet}/draftToken/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minId: tokenRand, maxId: tokenRand }),
  });
  console.log('Mint result:', JSON.stringify(mintResult).slice(0, 200));
  expect(mintResult?.tokens?.length).toBeGreaterThan(0);

  // 2. Join a fast draft
  console.log('Joining draft...');
  const joinResult = await fetchJson(`${API_BASE}/league/fast/owner/${wallet}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: 1 }),
  });
  const raw = Array.isArray(joinResult) ? joinResult[0] : joinResult;
  const draftId = raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? null;
  expect(draftId).toBeTruthy();
  console.log('Joined draft:', draftId);

  // 3. Fill with bots
  console.log('Filling with bots...');
  const fillResult = await fetchJson(
    `${API_BASE}/staging/fill-bots/fast?count=9&leagueId=${encodeURIComponent(draftId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  console.log('Fill result:', JSON.stringify(fillResult).slice(0, 200));

  // 4. Open WebSocket in browser and collect events
  await page.goto('about:blank');

  const results = await page.evaluate(
    async ({ wsUrl, wallet, draftId }) => {
      return new Promise<{
        timerUpdates: { endOfTurn: number; countdown: number; drafter: string; ts: number }[];
        infoUpdates: { pickNumber: number; drafter: string; ts: number }[];
      }>((resolve) => {
        const timerUpdates: { endOfTurn: number; countdown: number; drafter: string; ts: number }[] = [];
        const infoUpdates: { pickNumber: number; drafter: string; ts: number }[] = [];

        const url = `${wsUrl}/ws?address=${encodeURIComponent(wallet.toLowerCase())}&draftName=${encodeURIComponent(draftId)}`;
        const ws = new WebSocket(url);

        let pingInterval: ReturnType<typeof setInterval> | null = null;

        const finish = () => {
          if (pingInterval) clearInterval(pingInterval);
          ws.close();
          resolve({ timerUpdates, infoUpdates });
        };

        const timeout = setTimeout(finish, 90_000);

        ws.onopen = () => {
          console.log('[WS] Connected to', draftId);
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', payload: {} }));
            }
          }, 15_000);
        };

        ws.onmessage = (event) => {
          try {
            const { type, payload } = JSON.parse(event.data);
            const now = Date.now();

            if (type === 'timer_update' && payload?.endOfTurnTimestamp) {
              const countdown = Math.max(0, Math.ceil(payload.endOfTurnTimestamp - now / 1000));
              timerUpdates.push({
                endOfTurn: payload.endOfTurnTimestamp,
                countdown,
                drafter: (payload.currentDrafter || '').slice(0, 25),
                ts: now,
              });
            }

            if (type === 'draft_info_update' && payload?.pickNumber) {
              infoUpdates.push({
                pickNumber: payload.pickNumber,
                drafter: (payload.currentDrafter || '').slice(0, 25),
                ts: now,
              });
              // Stop after enough picks advance
              if (infoUpdates.length >= 4) {
                clearTimeout(timeout);
                setTimeout(finish, 3000);
              }
            }
          } catch {}
        };

        ws.onerror = () => {};
        ws.onclose = () => { if (pingInterval) clearInterval(pingInterval); };
      });
    },
    { wsUrl: WS_BASE, wallet, draftId: String(draftId) },
  );

  // 5. Analyze results
  console.log(`\nCollected ${results.timerUpdates.length} timer_update events`);
  console.log(`Collected ${results.infoUpdates.length} draft_info_update events\n`);

  for (const t of results.timerUpdates.slice(0, 15)) {
    console.log(`  timer: countdown=${t.countdown}s, endOfTurn=${t.endOfTurn}, drafter=${t.drafter}`);
  }
  console.log('');
  for (const i of results.infoUpdates) {
    console.log(`  info: pick#${i.pickNumber}, drafter=${i.drafter}`);
  }

  // ASSERT: We got timer_update events
  expect(results.timerUpdates.length).toBeGreaterThan(0);

  // ASSERT: Timer counts DOWN within same pick
  if (results.timerUpdates.length >= 3) {
    const firstEndOfTurn = results.timerUpdates[0].endOfTurn;
    const samePick = results.timerUpdates.filter(t => t.endOfTurn === firstEndOfTurn);
    if (samePick.length >= 2) {
      console.log(`\nSame-pick countdowns: ${samePick.map(t => t.countdown).join(', ')}`);
      expect(samePick[samePick.length - 1].countdown).toBeLessThanOrEqual(samePick[0].countdown);
      console.log('PASS: Timer counts down correctly');
    }
  }

  // ASSERT: Picks advance
  expect(results.infoUpdates.length).toBeGreaterThan(1);
  const firstPick = results.infoUpdates[0].pickNumber;
  const lastPick = results.infoUpdates[results.infoUpdates.length - 1].pickNumber;
  expect(lastPick).toBeGreaterThan(firstPick);
  console.log(`PASS: Picks advanced from ${firstPick} to ${lastPick}`);
});
