import { chromium } from 'playwright';
import fs from 'fs';

const API_URL = process.env.STAGING_API_URL;
const WS_URL = process.env.STAGING_WS_URL;
const BASE_URL = process.env.STAGING_FRONTEND_URL || 'https://sbs-frontend-v2.vercel.app';
const STAGING_WALLET = process.env.STAGING_WALLET || '0x0000000000000000000000000000000000000001';
const STAGING_SPEED = process.env.STAGING_SPEED || 'fast';

if (!API_URL || !WS_URL) {
  console.error('Missing STAGING_API_URL or STAGING_WS_URL');
  process.exit(1);
}

const outDir = 'artifacts/e2e-proof-board-live-picks';
fs.mkdirSync(outDir, { recursive: true });
const logs = [];

const mark = (msg) => {
  const line = `[step] ${msg}`;
  logs.push(line);
  console.log(line);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1560, height: 980 } });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('console', (msg) => logs.push(`[console:${msg.type()}] ${msg.text()}`));
page.on('response', (res) => {
  if (res.status() >= 400) logs.push(`[http:${res.status()}] ${res.url()}`);
});

const fetchWithTimeout = async (url, init = {}, timeoutMs = 45000) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
};

const joinDraftViaApi = async () => {
  mark('mint staging pass');
  await fetchWithTimeout(`${API_URL}/staging/mint/${STAGING_WALLET}/1`, { method: 'POST' });

  mark('join draft via staging api');
  const joinRes = await fetchWithTimeout(`${API_URL}/league/${STAGING_SPEED}/owner/${STAGING_WALLET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: 1 }),
  });
  const txt = await joinRes.text();
  logs.push(`[join:${joinRes.status}] ${txt}`);
  if (!joinRes.ok) throw new Error(`join failed: ${joinRes.status} ${txt}`);
  const parsed = JSON.parse(txt);
  const raw = Array.isArray(parsed) ? parsed[0] : parsed;
  const draftId = raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? raw?.id;
  if (!draftId) throw new Error('missing draftId from api join');
  return String(draftId);
};

const joinViaHome = async () => {
  const homeUrl = `${BASE_URL}/?staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}`;
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);

  try {
    await page.getByRole('button', { name: /enter/i }).first().click({ timeout: 20000 });
    await page.waitForTimeout(400);

    const draftPassBtn = page.getByRole('button', { name: /Draft Pass/i }).first();
    if (await draftPassBtn.isVisible().catch(() => false)) await draftPassBtn.click();

    const freeEntryBtn = page.getByRole('button', { name: /Free Entry \(Staging\)/i }).first();
    if (await freeEntryBtn.isVisible().catch(() => false)) {
      await freeEntryBtn.click();
      await page.waitForTimeout(500);
    }

    await page.getByRole('button', { name: STAGING_SPEED === 'fast' ? /Fast Draft/i : /Slow Draft/i }).first().click();
    await page.waitForURL(/\/draft-room\?/, { timeout: 120000 });
    return new URL(page.url()).searchParams.get('id');
  } catch (err) {
    logs.push(`[home-join-fallback] ${String(err)}`);
    return joinDraftViaApi();
  }
};

let proof = {};

try {
  const draftId = await joinViaHome();
  if (!draftId) throw new Error('missing draft id after join');
  mark(`draftId=${draftId}`);

  const roomUrl = `${BASE_URL}/draft-room?id=${encodeURIComponent(draftId)}&speed=${encodeURIComponent(STAGING_SPEED)}&staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}&debug=true`;
  await page.goto(roomUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  mark('wait for drafting stage and picks');
  await page.waitForFunction(() => document.querySelector('[data-stage-marker="drafting"]'), { timeout: 240000 });
  await page.waitForFunction(() => {
    const txt = document.body.innerText || '';
    return /totalPicks:\s*[2-9]|totalPicks:\s*[1-9][0-9]/i.test(txt) || /Round\s+[2-9],\s*Pick/i.test(txt);
  }, { timeout: 240000 });

  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/01-draft-live-before-board.png`, fullPage: true });

  mark('open board tab');
  await page.getByText(/^Board$/).first().click({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const bodyText = await page.locator('body').innerText();
  const hasPositionVisible = /\b(QB|RB|WR|TE|DST)\b/.test(bodyText) || /[A-Z]{2,3}-(QB|RB|WR|TE|DST)/.test(bodyText);
  const hasPlaceholderTokens = /R1\s*P1|R1\s*P2|R2\s*P1/.test(bodyText);

  await page.screenshot({ path: `${outDir}/02-board-live-picks-visible.png`, fullPage: true });

  proof = {
    success: hasPositionVisible,
    draftId,
    finalUrl: page.url(),
    hasPositionVisible,
    hasPlaceholderTokens,
    artifacts: [
      `${outDir}/01-draft-live-before-board.png`,
      `${outDir}/02-board-live-picks-visible.png`,
      `${outDir}/console.log`,
      `${outDir}/proof.json`
    ]
  };

  if (!hasPositionVisible) {
    throw new Error(`Board did not show drafted positions. hasPlaceholderTokens=${hasPlaceholderTokens}`);
  }
} catch (err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  logs.push(`[error] ${msg}`);
  try { await page.screenshot({ path: `${outDir}/99-failure.png`, fullPage: true }); } catch {}
  proof = { failed: true, error: msg };
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${outDir}/console.log`, logs.join('\n'));
  fs.writeFileSync(`${outDir}/proof.json`, JSON.stringify(proof, null, 2));
  await browser.close();
  console.log(JSON.stringify(proof, null, 2));
}
