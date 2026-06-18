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

const outDir = 'artifacts/e2e-proof-remote-draft-pick';
fs.mkdirSync(outDir, { recursive: true });
const logs = [];
const fetchWithTimeout = async (url, init = {}, timeoutMs = 45000) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
};

const mark = (msg) => {
  const line = `[step] ${msg}`;
  logs.push(line);
  console.log(line);
};

const mintStagingPass = async () => {
  mark('mint staging pass');
  const mintRes = await fetchWithTimeout(`${API_URL}/staging/mint/${STAGING_WALLET}/1`, { method: 'POST' });
  const txt = await mintRes.text();
  logs.push(`[mint:${mintRes.status}] ${txt}`);
};

const joinDraftViaApi = async () => {
  await mintStagingPass();
  const joinRes = await fetchWithTimeout(`${API_URL}/league/${STAGING_SPEED}/owner/${STAGING_WALLET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: 1 }),
  });
  const txt = await joinRes.text();
  logs.push(`[join:${joinRes.status}] ${txt}`);
  if (!joinRes.ok) throw new Error(`join failed: ${joinRes.status} ${txt}`);
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    throw new Error(`join non-json: ${txt}`);
  }
  const raw = Array.isArray(parsed) ? parsed[0] : parsed;
  const draftId = raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? raw?.id;
  if (!draftId) throw new Error(`join missing draftId: ${txt}`);
  return String(draftId);
};

const ensureDraftViaHomeJoin = async (page) => {
  const homeUrl = `${BASE_URL}/?staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}`;
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1200);
  try {
    await page.getByRole('button', { name: /enter/i }).first().click({ timeout: 15000 });
    await page.waitForTimeout(400);
    const draftPassBtn = page.getByRole('button', { name: /Draft Pass/i }).first();
    if (await draftPassBtn.isVisible().catch(() => false)) await draftPassBtn.click();
    const freeEntryBtn = page.getByRole('button', { name: /Free Entry \(Staging\)/i }).first();
    if (await freeEntryBtn.isVisible().catch(() => false)) await freeEntryBtn.click();
    await page.getByRole('button', { name: STAGING_SPEED === 'fast' ? /Fast Draft/i : /Slow Draft/i }).first().click({ timeout: 15000 });
    await page.waitForURL(/\/draft-room\?/, { timeout: 45000 });
    const id = new URL(page.url()).searchParams.get('id');
    if (!id) throw new Error('missing id after home join');
    return id;
  } catch (e) {
    logs.push(`[home-join-fallback] ${String(e)}`);
    return joinDraftViaApi();
  }
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('console', (msg) => logs.push(`[console:${msg.type()}] ${msg.text()}`));
page.on('response', (res) => {
  if (res.status() >= 400) logs.push(`[http:${res.status()}] ${res.url()}`);
});

try {
  const draftId = await ensureDraftViaHomeJoin(page);
  mark(`draft ${draftId}`);
  const url = `${BASE_URL}/draft-room?id=${encodeURIComponent(draftId)}&speed=${encodeURIComponent(STAGING_SPEED)}&staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}&debug=true`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  await page.waitForFunction(() => document.querySelector('[data-stage-marker="drafting"]'), { timeout: 240000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/01-drafting.png`, fullPage: true });

  const before = await page.evaluate(() => {
    const dbg = Array.from(document.querySelectorAll('div')).map((el) => el.textContent || '').find((t) => t.includes('phase:') && t.includes('connected:')) || null;
    const draftButtons = Array.from(document.querySelectorAll('button')).filter((b) => /draft/i.test(b.textContent || '') || /Draft\s/i.test(b.getAttribute('aria-label') || ''));
    const enabledDraftButtons = draftButtons.filter((b) => !(b).disabled).length;
    const body = document.body.innerText;
    const r0Count = (body.match(/R0/g) || []).length;
    return { dbg, draftButtons: draftButtons.length, enabledDraftButtons, body: body.slice(0, 1600), r0Count };
  });

  logs.push(`[before] ${JSON.stringify(before)}`);

  const yourTurnShown = /Your turn to draft!/i.test(before.body || '');

  const bodyText = await page.locator('body').innerText();
  const firstPlayerId = bodyText.match(/[A-Z]{2,3}-(?:QB|RB|WR|TE|DST)\d?/i)?.[0];
  if (firstPlayerId) {
    const playerRow = page.getByText(firstPlayerId, { exact: false }).first();
    if (await playerRow.isVisible().catch(() => false)) {
      await playerRow.click({ timeout: 10000 });
      await page.waitForTimeout(500);
    }
  }

  let firstDraft = page.locator('button[aria-label^="Draft "]').first();
  let isVisible = await firstDraft.isVisible().catch(() => false);
  if (!isVisible) {
    firstDraft = page.locator('button[aria-label^="Draft "], button:has-text("Draft")').first();
    isVisible = await firstDraft.isVisible().catch(() => false);
  }
  if (!isVisible) throw new Error('No Draft button visible in live drafting (even after expanding player row)');

  const isEnabled = await firstDraft.isEnabled().catch(() => false);
  if (!isEnabled) {
    throw new Error(`Draft button disabled at live stage. before=${JSON.stringify(before)}`);
  }

  const pickBefore = await page.evaluate(() => {
    const m = document.body.innerText.match(/Round\s+(\d+),\s+Pick\s+(\d+)/i);
    return m ? `${m[1]}-${m[2]}` : null;
  });

  await firstDraft.click({ timeout: 10000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outDir}/02-after-pick-click.png`, fullPage: true });

  const after = await page.evaluate(() => {
    const m = document.body.innerText.match(/Round\s+(\d+),\s+Pick\s+(\d+)/i);
    const dbg = Array.from(document.querySelectorAll('div')).map((el) => el.textContent || '').find((t) => t.includes('phase:') && t.includes('connected:')) || null;
    return { roundPick: m ? `${m[1]}-${m[2]}` : null, dbg, body: document.body.innerText.slice(0, 1200) };
  });

  logs.push(`[after] ${JSON.stringify(after)}`);

  const advanced = pickBefore && after.roundPick && pickBefore !== after.roundPick;
  const headerIdentityOk = /On the Clock:\s*StagingTester/i.test(before.body) || /StagingTester/i.test(before.dbg || '');
  const placeholderRegressionGone = (before.r0Count ?? 0) < 8;
  const inlineDraftVisible = isVisible;
  const parityLockOk = !yourTurnShown || inlineDraftVisible;
  const success = Boolean(advanced && headerIdentityOk && placeholderRegressionGone && parityLockOk);

  const proof = { success, draftId, pickBefore, after, yourTurnShown, inlineDraftVisible, parityLockOk, advanced, headerIdentityOk, placeholderRegressionGone, r0Count: before.r0Count };
  fs.writeFileSync(`${outDir}/proof.json`, JSON.stringify(proof, null, 2));
  fs.writeFileSync(`${outDir}/console.log`, logs.join('\n'));
  if (!success) throw new Error(`Pick did not advance. ${JSON.stringify(proof)}`);
  console.log(JSON.stringify(proof, null, 2));
} catch (err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  logs.push(`[error] ${msg}`);
  try { await page.screenshot({ path: `${outDir}/99-failure.png`, fullPage: true }); } catch {}
  fs.writeFileSync(`${outDir}/console.log`, logs.join('\n'));
  const fail = { failed: true, error: msg };
  fs.writeFileSync(`${outDir}/proof.json`, JSON.stringify(fail, null, 2));
  console.error(msg);
  process.exitCode = 1;
} finally {
  await browser.close();
}
