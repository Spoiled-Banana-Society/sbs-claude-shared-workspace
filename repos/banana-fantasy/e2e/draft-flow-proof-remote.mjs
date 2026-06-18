import { chromium } from 'playwright';
import fs from 'fs';

const API_URL = process.env.STAGING_API_URL;
const WS_URL = process.env.STAGING_WS_URL;
const BASE_URL = process.env.STAGING_FRONTEND_URL || 'https://sbs-frontend-v2.vercel.app';

if (!API_URL || !WS_URL) {
  console.error('Missing STAGING_API_URL or STAGING_WS_URL');
  process.exit(1);
}

const outDir = 'artifacts/e2e-proof-remote';
fs.mkdirSync(outDir, { recursive: true });

const STAGING_WALLET = process.env.STAGING_WALLET || '0x0000000000000000000000000000000000000001';

const logs = [];
const mark = (msg) => {
  const line = `[step] ${msg}`;
  logs.push(line);
  console.log(line);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);

page.on('console', (msg) => logs.push(`[console:${msg.type()}] ${msg.text()}`));
page.on('response', (res) => {
  const status = res.status();
  if (status >= 400) logs.push(`[http:${status}] ${res.url()}`);
});

let proof = {};

try {
  mark(`mint staging pass for ${STAGING_WALLET}`);
  const mintRes = await fetch(`${API_URL}/staging/mint/${STAGING_WALLET}/1`, { method: 'POST' });
  const mintText = await mintRes.text();
  logs.push(`[mint:${mintRes.status}] ${mintText}`);

  const homeUrl = `${BASE_URL}/?staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}`;
  mark(`goto home ${homeUrl}`);
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/01-home.png`, fullPage: true });

  mark('click Enter');
  await page.getByRole('button', { name: /enter/i }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/02-entry-modal.png`, fullPage: true });

  mark('select pass type if needed');
  const draftPassBtn = page.getByRole('button', { name: /Draft Pass/i }).first();
  if (await draftPassBtn.isVisible().catch(() => false)) {
    await draftPassBtn.click();
  }

  mark('trigger staging free entry if available');
  const freeEntryBtn = page.getByRole('button', { name: /Free Entry \(Staging\)/i }).first();
  if (await freeEntryBtn.isVisible().catch(() => false)) {
    await freeEntryBtn.click();
    await page.waitForTimeout(600);
  }

  mark('pick Fast Draft');
  await page.getByRole('button', { name: /Fast Draft/i }).first().click();

  mark('wait /draft-room');
  await page.waitForURL(/\/draft-room\?/, { timeout: 90000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}/03-draft-room-filling.png`, fullPage: true });

  mark('wait for staging flow progress (lobby/countdown/drafting)');
  await page.waitForFunction(
    () => {
      const text = document.body.innerText || '';
      return /10\/10 joined/i.test(text) || /Draft is starting/i.test(text) || /Round\s+\d+,\s+Pick\s+\d+/i.test(text);
    },
    { timeout: 120000 }
  );
  await page.screenshot({ path: `${outDir}/04-progress.png`, fullPage: true });

  mark('wait live drafting');
  await page.waitForFunction(() => /Round\s+\d+,\s+Pick\s+\d+/i.test(document.body.innerText), { timeout: 150000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/05-live-draft.png`, fullPage: true });

  const bodyText = await page.locator('body').innerText();
  const allHttp = logs.filter((l) => l.includes('[http:'));
  proof = {
    baseUrl: BASE_URL,
    apiUrl: API_URL,
    wsUrl: WS_URL,
    finalUrl: page.url(),
    noDraftingRoute: !page.url().includes('/drafting'),
    lobbyReached: /10\/10 joined/i.test(bodyText),
    countdownVisible: /Draft is starting/i.test(bodyText),
    liveRoundPickVisible: /Round\s+\d+,\s+Pick\s+\d+/i.test(bodyText),
    timerVisible: /Timer\s+\d+:\d{2}/i.test(bodyText),
    onClockVisible: /On the Clock:/i.test(bodyText),
    http500Count: logs.filter((l) => l.includes('[http:500]')).length,
    sampleErrors: allHttp.slice(0, 15),
  };
  mark('success');
} catch (err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  logs.push(`[error] ${msg}`);
  try {
    await page.screenshot({ path: `${outDir}/99-failure.png`, fullPage: true });
  } catch {}
  proof = { failed: true, error: msg, finalUrl: page.url(), baseUrl: BASE_URL, apiUrl: API_URL, wsUrl: WS_URL };
  console.error(msg);
} finally {
  fs.writeFileSync(`${outDir}/proof.json`, JSON.stringify(proof, null, 2));
  fs.writeFileSync(`${outDir}/console.log`, logs.join('\n'));
  await browser.close();
}

console.log(JSON.stringify(proof, null, 2));
