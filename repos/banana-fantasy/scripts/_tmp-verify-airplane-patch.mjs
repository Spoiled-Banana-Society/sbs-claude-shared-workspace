#!/usr/bin/env node
// Live verification of the airplane-toggle server-persist fix.
// Loads the LIVE deployed draft-room in live mode during a FILLING phase
// with a synthetic wallet, clicks the airplane toggle, and asserts the
// client sent PATCH /preferences {autoDraft:true} and got 200.
// Also counts /api traffic for 10s to prove no render-loop fetch storm.
import { chromium } from 'playwright';

const WALLET = '0x0000000000000000000000000000000000c1a0de';
const DRAFT = process.argv[2] || '2026-slow-draft-6';
const URL = `https://banana-fantasy-sbs.vercel.app/draft-room?id=${DRAFT}&mode=live&wallet=${WALLET}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const prefCalls = [];
let apiCount = 0;
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('/preferences')) {
    let body = '';
    try { body = res.request().postData() || ''; } catch {}
    prefCalls.push({ method: res.request().method(), status: res.status(), body, url: u.slice(-90) });
  }
  if (u.includes('/api/') || u.includes('run.app')) apiCount++;
});

console.log('loading', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);

const btn = page.locator('button[title*="Auto-draft"]');
const visible = await btn.isVisible().catch(() => false);
console.log('airplane button visible:', visible);
if (!visible) {
  await page.screenshot({ path: '/Users/richardvagner/Downloads/_airplane_verify_fail.png' });
  console.log('phase text on page:', (await page.textContent('body') || '').slice(0, 300));
  await browser.close();
  process.exit(2);
}
console.log('button title before click:', await btn.getAttribute('title'));
apiCount = 0;
await btn.click();
await page.waitForTimeout(4000);
console.log('button title after click :', await btn.getAttribute('title'));
console.log('PATCH/GET /preferences calls seen:');
for (const c of prefCalls) console.log(' ', c.method, c.status, c.body || '(no body)', c.url);

// Render-loop check: 10 more seconds of idle traffic
apiCount = 0;
await page.waitForTimeout(10000);
console.log('api-ish requests in 10s idle:', apiCount, apiCount > 75 ? '⚠️ STORM' : '(normal)');

await page.screenshot({ path: '/Users/richardvagner/Downloads/_airplane_verify.png' });
await browser.close();

const patched = prefCalls.find(c => c.method === 'PATCH' && c.status === 200 && /true/.test(c.body));
console.log(patched ? '✅ PATCH autoDraft=true confirmed on live site' : '❌ no successful PATCH observed');
process.exit(patched ? 0 : 1);
