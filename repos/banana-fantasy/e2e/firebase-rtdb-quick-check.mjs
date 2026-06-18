#!/usr/bin/env node
/**
 * Quick check — use existing draft 2024-fast-draft-22 which has state + active picks
 */
import { chromium } from 'playwright';

const VERCEL = 'https://banana-fantasy-sbs.vercel.app';
const API = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const WALLET = '0x59dd025b0aa0fecf39f2c69fc7aea9f943b8779e';
const DRAFT = '2024-fast-draft-22';

async function main() {
  // Check current draft state
  const infoRes = await fetch(`${API}/draft/${DRAFT}/state/info`);
  const info = await infoRes.json();
  console.log(`Draft ${DRAFT}: pick ${info.pickNumber}, round ${info.roundNum}, drafter: ${info.currentDrafter?.substring(0,20)}`);
  console.log(`  pickLength: ${info.pickLength}, draftStartTime: ${info.draftStartTime}`);

  const summaryRes = await fetch(`${API}/draft/${DRAFT}/state/summary`);
  const summaryText = await summaryRes.text();
  console.log(`  Summary status: ${summaryRes.status}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const importantLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Firebase') || text.includes('RTDB') || text.includes('[Draft Room]') ||
        text.includes('[WS]') || text.includes('Watchdog') || text.includes('Engine') ||
        text.includes('engine') || text.includes('firebaseState') || text.includes('PERMISSION')) {
      importantLogs.push(`[${msg.type()}] ${text}`);
    }
  });

  // Open with useWs=true to force WS mode
  const url = `${VERCEL}/draft-room?draftId=${DRAFT}&id=${DRAFT}&speed=fast&mode=live&wallet=${WALLET}&staging=true&useWs=true`;
  console.log(`\nOpening with useWs=true: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('Waiting 30 seconds...');
  await page.waitForTimeout(30000);
  await page.screenshot({ path: '/tmp/e2e-final-ws-mode.png', fullPage: true });

  const body = await page.locator('body').textContent() || '';
  const indicator = await page.evaluate(() => {
    const spans = document.querySelectorAll('span.text-xs');
    for (const s of spans) {
      const t = s.textContent || '';
      if (t === 'Live' || t === 'WS' || t === 'Connecting...') return t;
    }
    return null;
  });

  console.log(`\nIndicator: "${indicator}"`);
  console.log(`Round visible: ${/Round\s+\d+/i.test(body)}`);
  console.log(`Pick visible: ${/Pick\s+\d+/i.test(body)}`);
  console.log(`Timer visible: ${/\d+:\d{2}/.test(body)}`);
  console.log(`"On the Clock": ${/On the Clock/i.test(body)}`);

  console.log(`\nImportant logs (${importantLogs.length}):`);
  importantLogs.forEach(l => console.log(`  ${l.substring(0, 200)}`));

  // Check current pick after waiting
  const info2 = await fetch(`${API}/draft/${DRAFT}/state/info`).then(r => r.json());
  console.log(`\nDraft now at: pick ${info2.pickNumber}, round ${info2.roundNum}`);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
