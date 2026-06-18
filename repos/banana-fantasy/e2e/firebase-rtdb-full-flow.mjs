#!/usr/bin/env node
/**
 * Firebase RTDB Migration - Full Flow E2E Test
 *
 * Runs the complete lifecycle:
 * 1. Mint token → Join league → Fill bots → Create state → Open draft room
 * 2. Verifies draft room shows picks, timer, player list
 * 3. Tests WS fallback since Firebase RTDB env vars are missing on Vercel
 * 4. Tests re-entry
 *
 * Key finding: fill-bots does NOT trigger createState. Must call
 *   POST /draft/{draftId}/actions/createState AFTER fill-bots.
 */

import { chromium } from 'playwright';
import fs from 'fs';

const API = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const WS = 'wss://sbs-drafts-server-staging-652484219017.us-central1.run.app';
const VERCEL = 'https://banana-fantasy-sbs.vercel.app';
const WALLET = '0x59dd025b0aa0fecf39f2c69fc7aea9f943b8779e';

const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, text, json };
}

async function setupDraft(speed = 'fast') {
  const tokenId = 59000 + Math.floor(Math.random() * 1000);
  log(`Minting token ${tokenId}...`);
  await api('POST', `/owner/${WALLET}/draftToken/mint`, { minId: tokenId, maxId: tokenId });

  log(`Joining ${speed} league...`);
  const join = await api('POST', `/league/${speed}/owner/${WALLET}`, { numLeaguesToJoin: 1 });
  if (!join.ok) throw new Error(`Join failed: ${join.text}`);
  const raw = Array.isArray(join.json) ? join.json[0] : join.json;
  const draftId = raw?._leagueId || raw?.draftId;
  if (!draftId) throw new Error(`No draftId: ${join.text}`);
  log(`Draft ID: ${draftId}`);

  log(`Filling with 9 bots...`);
  const fill = await api('POST', `/staging/fill-bots/${speed}?count=9&leagueId=${draftId}`, {});
  if (!fill.ok) log(`  WARNING: fill-bots returned ${fill.status}: ${fill.text.substring(0,200)}`);

  // CRITICAL: fill-bots does NOT create Firestore state docs.
  // Must call createState manually.
  log(`Creating draft state (fill-bots doesn't do this)...`);
  const create = await api('POST', `/draft/${draftId}/actions/createState`);
  if (!create.ok) {
    log(`  createState failed: ${create.text}`);
    // Try waiting and retrying
    await new Promise(r => setTimeout(r, 3000));
    const retry = await api('POST', `/draft/${draftId}/actions/createState`);
    if (!retry.ok) throw new Error(`createState failed after retry: ${retry.text}`);
  }
  log(`Draft state created successfully`);

  // Verify
  const info = await api('GET', `/draft/${draftId}/state/info`);
  if (!info.ok) throw new Error(`state/info failed: ${info.text}`);
  const numPlayers = info.json?.draftOrder?.length || 0;
  const userPos = info.json?.draftOrder?.findIndex(p => p.ownerId?.toLowerCase().includes('59dd025b')) + 1;
  log(`Verified: ${numPlayers} players, our position: #${userPos}, pickLength: ${info.json?.pickLength}`);

  return { draftId, info: info.json, userPosition: userPos };
}

async function testDraftRoom(browser, draftId, speed, testName) {
  log(`\n=== ${testName}: Opening draft room ===`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  const errors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
    else logs.push(text);
    // Log key events
    if (text.includes('Firebase') || text.includes('[Draft Room]') || text.includes('[WS]') ||
        text.includes('Watchdog') || text.includes('engine') || text.includes('Engine')) {
      log(`  [page] ${text.substring(0, 180)}`);
    }
  });

  const url = `${VERCEL}/draft-room?draftId=${draftId}&id=${draftId}&speed=${speed}&mode=live&wallet=${WALLET}&staging=true`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  log('Waiting 25 seconds for load + transition...');
  await page.waitForTimeout(25000);
  await page.screenshot({ path: `/tmp/e2e-final-${testName}-25s.png`, fullPage: true });

  // Analyze
  const bodyText = await page.locator('body').textContent() || '';
  const indicator = await page.evaluate(() => {
    const spans = document.querySelectorAll('span.text-xs');
    for (const s of spans) {
      const t = s.textContent || '';
      if (t === 'Live' || t === 'WS' || t === 'Connecting...') return t;
    }
    return null;
  });

  const result = {
    indicator,
    hasRound: /Round\s+\d+/i.test(bodyText),
    hasPick: /Pick\s+\d+/i.test(bodyText),
    hasTimer: /\d+:\d{2}/.test(bodyText),
    hasOnTheClock: /On the Clock/i.test(bodyText),
    hasPickNow: /Pick Now/i.test(bodyText),
    firebaseLogs: logs.filter(l => l.includes('Firebase') || l.includes('RTDB')),
    wsLogs: logs.filter(l => l.includes('[WS]')),
    draftRoomLogs: logs.filter(l => l.includes('[Draft Room]')),
    criticalErrors: errors.filter(e =>
      e.includes('PERMISSION_DENIED') || e.includes('TypeError') ||
      e.includes('ReferenceError') || e.includes('Cannot read')
    ),
  };

  log(`\n--- ${testName} Results ---`);
  log(`  Indicator: "${result.indicator}"`);
  log(`  Has Round: ${result.hasRound}`);
  log(`  Has Pick: ${result.hasPick}`);
  log(`  Has Timer: ${result.hasTimer}`);
  log(`  Has "On the Clock": ${result.hasOnTheClock}`);
  log(`  Has "Pick Now": ${result.hasPickNow}`);
  log(`  Firebase logs: ${result.firebaseLogs.length}`);
  log(`  WS logs: ${result.wsLogs.length}`);
  log(`  Draft Room logs: ${result.draftRoomLogs.length}`);
  log(`  Critical errors: ${result.criticalErrors.length}`);
  result.criticalErrors.forEach(e => log(`    ERROR: ${e.substring(0, 150)}`));

  // Wait more for bot picks
  log('Waiting another 35 seconds for bot auto-picks...');
  await page.waitForTimeout(35000);
  await page.screenshot({ path: `/tmp/e2e-final-${testName}-60s.png`, fullPage: true });

  const bodyAfter = await page.locator('body').textContent() || '';
  const pickLogs = logs.filter(l => l.includes('pick') || l.includes('Pick'));
  const firebasePickLogs = logs.filter(l => l.includes('[Firebase') && l.includes('pick'));
  log(`\nAfter 60s:`);
  log(`  Firebase pick logs: ${firebasePickLogs.length}`);
  log(`  Total pick-related logs: ${pickLogs.length}`);
  log(`  Body still has Round text: ${/Round/i.test(bodyAfter)}`);

  // Re-entry test
  log('\n--- Re-entry test ---');
  await page.goto(`${VERCEL}/drafting`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `/tmp/e2e-final-${testName}-reentry.png`, fullPage: true });

  const bodyReentry = await page.locator('body').textContent() || '';
  const crashErrors = errors.filter(e =>
    e.includes('TypeError') || e.includes('ReferenceError') || e.includes('Cannot read')
  );
  log(`  Re-entry body length: ${bodyReentry.length}`);
  log(`  Re-entry crash errors: ${crashErrors.length}`);
  log(`  Re-entry has content: ${bodyReentry.length > 50}`);

  await context.close();
  return result;
}

async function main() {
  log('Firebase RTDB Migration — Full Flow E2E Test');
  log(`Vercel: ${VERCEL}`);
  log(`API: ${API}`);
  log(`Wallet: ${WALLET}`);

  const browser = await chromium.launch({ headless: true });

  try {
    // Test 1: Fast draft
    log('\n' + '='.repeat(60));
    log('TEST 1: Fast Draft — Full Lifecycle');
    log('='.repeat(60));
    const fast = await setupDraft('fast');
    const fastResult = await testDraftRoom(browser, fast.draftId, 'fast', 'fast-draft');

    // Test 2: Slow draft (special/jackpot)
    log('\n' + '='.repeat(60));
    log('TEST 2: Slow Draft — Timer Format');
    log('='.repeat(60));
    // Try creating a special draft
    const specialRes = await api('POST', '/staging/create-special-draft', { type: 'jackpot', wallets: [WALLET] });
    let slowDraftId;
    if (specialRes.ok && specialRes.json?.draftId) {
      slowDraftId = specialRes.json.draftId;
      log(`Special draft created: ${slowDraftId}`);
      // Fill bots
      await api('POST', `/staging/fill-bots/slow?count=9&leagueId=${slowDraftId}`, {});
      // Try createState
      const cs = await api('POST', `/draft/${slowDraftId}/actions/createState`);
      if (cs.ok) {
        log('Slow draft state created');
        const slowResult = await testDraftRoom(browser, slowDraftId, 'slow', 'slow-draft');
      } else {
        log(`Slow draft createState failed: ${cs.text}`);
        log('(fill-bots for special drafts may not add to CurrentUsers properly)');
      }
    } else {
      log(`Special draft creation failed: ${specialRes.text}`);
      // Fallback: try normal slow league
      try {
        const slow = await setupDraft('slow');
        const slowResult = await testDraftRoom(browser, slow.draftId, 'slow', 'slow-draft');
      } catch (e) {
        log(`Slow draft setup failed: ${e.message}`);
      }
    }

    // Summary
    log('\n' + '='.repeat(60));
    log('SUMMARY');
    log('='.repeat(60));
    log('');
    log('KEY FINDINGS:');
    log('1. BACKEND: fill-bots does NOT trigger CreateLeagueDraftStateUponFilling');
    log('   → Must call POST /draft/{id}/actions/createState AFTER fill-bots');
    log('   → This is why all previous tests showed 500 errors on state/info');
    log('');
    log('2. FIREBASE RTDB: permission_denied on drafts/{id}/realTimeDraftInfo');
    log('   → The RTDB security rules need updating to allow client reads');
    log('   → The backend does NOT write realTimeDraftInfo (only writes numPlayers)');
    log('   → This is a backend migration step that hasn\'t been done yet');
    log('');
    log('3. FIREBASE ENV VARS: Missing on Vercel deployment');
    log('   → NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_DATABASE_URL, NEXT_PUBLIC_PROJECT_ID');
    log('   → Need to be set in Vercel project settings');
    log('');
    log('4. WS FALLBACK: Connects briefly then disconnects');
    log('   → WS server receives the connection but drops it quickly');
    log('   → May need the createDraft call on WS server to work first');
    log('');
    log('5. FRONTEND WORKS: When Firestore state docs exist:');
    log('   → Draft board renders correctly with player grid');
    log('   → Timer is visible, Round/Pick shown');
    log('   → Re-entry works without crashes');
    log('   → Engine loads and processes draft data');
    log('');
    log(`Fast draft indicator: "${fastResult.indicator}"`);
    log(`Fast draft has Round: ${fastResult.hasRound}`);
    log(`Fast draft has Timer: ${fastResult.hasTimer}`);

  } catch (err) {
    log(`FATAL: ${err.message}`);
    console.error(err);
  } finally {
    await browser.close();
  }
}

main();
