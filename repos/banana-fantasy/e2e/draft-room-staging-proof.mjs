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

const outDir = 'artifacts/e2e-proof-remote-draft-room';
fs.mkdirSync(outDir, { recursive: true });

const logs = [];
const stepTimes = {};
const checkpoints = [];
const STAGE_SEQUENCE = ['filling', 'full_15s', 'type_spin', 'type_reveal', 'starts_soon_30s', 'drafting'];

const mark = (msg) => {
  const line = `[step] ${msg}`;
  logs.push(line);
  console.log(line);
};

const joinDraftViaApi = async () => {
  mark(`api join fallback: ${STAGING_SPEED} for ${STAGING_WALLET}`);
  const joinRes = await fetch(`${API_URL}/league/${STAGING_SPEED}/owner/${STAGING_WALLET}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: 1 }),
  });
  const joinText = await joinRes.text();
  logs.push(`[join:${joinRes.status}] ${joinText}`);
  if (!joinRes.ok) throw new Error(`API join failed: ${joinRes.status} ${joinText}`);

  let parsed;
  try {
    parsed = JSON.parse(joinText);
  } catch {
    throw new Error(`API join response was not JSON: ${joinText}`);
  }

  const raw = Array.isArray(parsed) ? parsed[0] : parsed;
  const draftId =
    raw?._leagueId ?? raw?.draftId ?? raw?.draftName ?? raw?.leagueId ?? raw?.id ?? null;
  if (!draftId) throw new Error(`API join response missing draft id: ${joinText}`);
  return String(draftId);
};

const ensureFreshDraftIdViaHomeJoin = async (page) => {
  mark(`mint staging pass for ${STAGING_WALLET}`);
  const mintRes = await fetch(`${API_URL}/staging/mint/${STAGING_WALLET}/1`, { method: 'POST' });
  const mintText = await mintRes.text();
  logs.push(`[mint:${mintRes.status}] ${mintText}`);

  const homeUrl = `${BASE_URL}/?staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}`;
  mark(`goto home ${homeUrl}`);
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);

  try {
    mark('home join flow: click Enter');
    await page.getByRole('button', { name: /enter/i }).first().click({ timeout: 15000 });
    await page.waitForTimeout(500);

    const draftPassBtn = page.getByRole('button', { name: /Draft Pass/i }).first();
    if (await draftPassBtn.isVisible().catch(() => false)) await draftPassBtn.click();

    const freeEntryBtn = page.getByRole('button', { name: /Free Entry \(Staging\)/i }).first();
    if (await freeEntryBtn.isVisible().catch(() => false)) {
      await freeEntryBtn.click();
      await page.waitForTimeout(600);
    }

    mark(`home join flow: pick ${STAGING_SPEED} draft`);
    const pickLabel = STAGING_SPEED === 'fast' ? /Fast Draft/i : /Slow Draft/i;
    await page.getByRole('button', { name: pickLabel }).first().click({ timeout: 15000 });

    await page.waitForURL(/\/draft-room\?/, { timeout: 45000 });
    const url = new URL(page.url());
    const draftId = url.searchParams.get('id');
    if (!draftId) throw new Error('Join flow reached /draft-room but no draft id in URL');
    return draftId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`[home-join-fallback] ${msg}`);
    return joinDraftViaApi();
  }
};

const waitForStageMarker = async (page, stage, timeout = 120000) => {
  await page.waitForFunction(
    (target) => {
      const root = document.querySelector('[data-testid="draft-room-root"]');
      const htmlStage = document.documentElement.getAttribute('data-draft-room-stage');
      const bodyStage = document.body.getAttribute('data-draft-room-stage');
      const rootStage = root?.getAttribute('data-stage');
      const marker = document.querySelector(`[data-stage-marker="${target}"]`);
      return htmlStage === target || bodyStage === target || rootStage === target || Boolean(marker);
    },
    stage,
    { timeout }
  );
};

const getEvidence = async (page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="draft-room-root"]');
    const events = window.__stageEvents || [];
    const diagnostics = window.__draftDiagnostics || [];
    return {
      rootStage: root?.getAttribute('data-stage') || null,
      htmlStage: document.documentElement.getAttribute('data-draft-room-stage'),
      bodyStage: document.body.getAttribute('data-draft-room-stage'),
      markerStage: document.querySelector('[data-stage-marker]')?.getAttribute('data-stage-marker') || null,
      stageEvents: events,
      diagnostics,
      stageSequenceObserved: Array.from(new Set(events.map((e) => e.stage))),
      bodyText: document.body.innerText,
    };
  });

const recordCheckpoint = async (id, name, fn, page) => {
  const startedAt = Date.now();
  try {
    const details = await fn();
    const evidence = await getEvidence(page);
    checkpoints.push({ id, name, pass: true, startedAt, endedAt: Date.now(), details, evidence });
    return true;
  } catch (error) {
    const evidence = await getEvidence(page).catch(() => ({}));
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    checkpoints.push({ id, name, pass: false, startedAt, endedAt: Date.now(), error: message, evidence });
    throw error;
  }
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  window.__stageEvents = [];
  window.__draftDiagnostics = [];
  window.addEventListener('sbs:draft-room-stage', (event) => {
    const detail = event?.detail ?? {};
    window.__stageEvents.push({ stage: detail.stage, draftId: detail.draftId, at: Date.now() });
  });
  window.addEventListener('sbs:draft-room-diagnostic', (event) => {
    const detail = event?.detail ?? {};
    window.__draftDiagnostics.push({ ...detail, at: detail.at ?? Date.now() });
  });
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

page.on('console', (msg) => logs.push(`[console:${msg.type()}] ${msg.text()}`));
page.on('response', (res) => {
  if (res.status() >= 400) logs.push(`[http:${res.status()}] ${res.url()}`);
});

let proof = {};

try {
  const DRAFT_ID = process.env.STAGING_DRAFT_ID || (await ensureFreshDraftIdViaHomeJoin(page));
  const url = `${BASE_URL}/draft-room?id=${encodeURIComponent(DRAFT_ID)}&speed=${encodeURIComponent(STAGING_SPEED)}&staging=true&wallet=${encodeURIComponent(STAGING_WALLET)}&apiUrl=${encodeURIComponent(API_URL)}&wsUrl=${encodeURIComponent(WS_URL)}&debug=true`;
  mark(`goto draft-room proof URL ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  await recordCheckpoint(
    1,
    'room available immediately after join path',
    async () => {
      await waitForStageMarker(page, 'filling', 45000);
      stepTimes.step1 = Date.now();
      await page.screenshot({ path: `${outDir}/01-room-immediate.png`, fullPage: true });
      return { expectedStage: 'filling' };
    },
    page
  );

  await recordCheckpoint(
    2,
    'room-full progression evidence',
    async () => {
      await waitForStageMarker(page, 'full_15s', 120000);
      const evidence = await getEvidence(page);
      const idxFilling = evidence.stageSequenceObserved.indexOf('filling');
      const idxFull = evidence.stageSequenceObserved.indexOf('full_15s');
      if (idxFilling === -1 || idxFull === -1 || idxFull < idxFilling) {
        throw new Error(`Invalid stage progression: ${JSON.stringify(evidence.stageSequenceObserved)}`);
      }
      stepTimes.step2 = Date.now();
      await page.screenshot({ path: `${outDir}/02-filling-full.png`, fullPage: true });
      return { sequence: evidence.stageSequenceObserved };
    },
    page
  );

  await recordCheckpoint(
    3,
    'full_15s stage with pick position',
    async () => {
      await waitForStageMarker(page, 'full_15s', 60000);
      await page.waitForFunction(() => /You pick\s+#\d+\s+of 10/i.test(document.body.innerText), { timeout: 30000 });
      stepTimes.step3 = Date.now();
      await page.screenshot({ path: `${outDir}/03-full-15s.png`, fullPage: true });
      return { expectedStage: 'full_15s', hasPickPosition: true };
    },
    page
  );

  await recordCheckpoint(
    4,
    'type_spin stage sequence assertion',
    async () => {
      await waitForStageMarker(page, 'type_spin', 120000);
      const evidence = await getEvidence(page);
      const idxSpin = evidence.stageSequenceObserved.indexOf('type_spin');
      const idxFull = evidence.stageSequenceObserved.indexOf('full_15s');
      if (idxSpin === -1 || idxFull === -1 || idxSpin < idxFull) {
        throw new Error(`type_spin out of order: ${JSON.stringify(evidence.stageSequenceObserved)}`);
      }
      stepTimes.step4 = Date.now();
      await page.screenshot({ path: `${outDir}/04-type-spin.png`, fullPage: true });
      return { sequence: evidence.stageSequenceObserved };
    },
    page
  );

  await recordCheckpoint(
    5,
    'type_reveal stage + treatment visible',
    async () => {
      await waitForStageMarker(page, 'type_reveal', 60000);
      await page.waitForFunction(() => /Jackpot League|Hall of Fame League|Regular League/i.test(document.body.innerText), { timeout: 60000 });
      stepTimes.step5 = Date.now();
      await page.screenshot({ path: `${outDir}/05-type-reveal.png`, fullPage: true });
      return { expectedStage: 'type_reveal', treatmentVisible: true };
    },
    page
  );

  await recordCheckpoint(
    6,
    'starts_soon_30s stage sequence assertion',
    async () => {
      await waitForStageMarker(page, 'starts_soon_30s', 90000);
      const evidence = await getEvidence(page);
      const idxSoon = evidence.stageSequenceObserved.indexOf('starts_soon_30s');
      const idxReveal = evidence.stageSequenceObserved.indexOf('type_reveal');
      if (idxSoon === -1 || idxReveal === -1 || idxSoon < idxReveal) {
        throw new Error(`starts_soon_30s out of order: ${JSON.stringify(evidence.stageSequenceObserved)}`);
      }
      stepTimes.step6 = Date.now();
      await page.screenshot({ path: `${outDir}/06-starts-soon-30s.png`, fullPage: true });
      return { sequence: evidence.stageSequenceObserved };
    },
    page
  );

  await recordCheckpoint(
    7,
    'drafting stage marker + reconciliation diagnostics contract',
    async () => {
      await waitForStageMarker(page, 'drafting', 180000);
      await page.waitForFunction(() => /Round\s+\d+,\s+Pick\s+\d+/i.test(document.body.innerText), { timeout: 180000 });
      await page.waitForTimeout(5000);
      const evidence = await getEvidence(page);
      const seq = evidence.stageSequenceObserved;
      const idxDrafting = seq.indexOf('drafting');
      const idxSoon = seq.indexOf('starts_soon_30s');
      const hasOrderedPreDraft = idxSoon !== -1 && idxDrafting !== -1 && idxSoon < idxDrafting;
      const bypassEvents = (evidence.diagnostics || []).filter((d) => d?.event === 'draft_start_bypass');
      if (!hasOrderedPreDraft && bypassEvents.length === 0) {
        throw new Error(`Silent pre-draft skip detected. seq=${JSON.stringify(seq)} diagnostics=${JSON.stringify(evidence.diagnostics || [])}`);
      }
      stepTimes.step7 = Date.now();
      await page.screenshot({ path: `${outDir}/07-drafting-live.png`, fullPage: true });
      return {
        expectedStage: 'drafting',
        liveStatusVisible: true,
        hasOrderedPreDraft,
        bypassEvents,
      };
    },
    page
  );

  const finalEvidence = await getEvidence(page);
  const stageOrderValid = STAGE_SEQUENCE.every((stage, idx) => {
    if (idx === 0) return true;
    return finalEvidence.stageSequenceObserved.indexOf(stage) >= finalEvidence.stageSequenceObserved.indexOf(STAGE_SEQUENCE[idx - 1]);
  });

  proof = {
    draftId: DRAFT_ID,
    stagingWallet: STAGING_WALLET,
    speed: STAGING_SPEED,
    baseUrl: BASE_URL,
    apiUrl: API_URL,
    wsUrl: WS_URL,
    finalUrl: page.url(),
    checkpoints,
    stageMarkersObserved: finalEvidence.stageSequenceObserved,
    stageEvents: finalEvidence.stageEvents,
    diagnostics: finalEvidence.diagnostics,
    hasBypassDiagnostics: (finalEvidence.diagnostics || []).some((d) => d?.event === 'draft_start_bypass'),
    hasDeferredDiagnostics: (finalEvidence.diagnostics || []).some((d) => d?.event === 'draft_start_deferred'),
    stageOrderValid,
    liveRoundPickVisible: /Round\s+\d+,\s+Pick\s+\d+/i.test(finalEvidence.bodyText),
    timerVisible: /Timer\s+\d+:\d{2}/i.test(finalEvidence.bodyText),
    onClockVisible: /On the Clock:/i.test(finalEvidence.bodyText),
    http500Count: logs.filter((l) => l.includes('[http:500]')).length,
    sampleErrors: logs.filter((l) => l.includes('[http:')).slice(0, 20),
    stepTimes,
  };
  mark('success');
} catch (err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  logs.push(`[error] ${msg}`);
  try {
    await page.screenshot({ path: `${outDir}/99-failure.png`, fullPage: true });
  } catch {}
  const evidence = await getEvidence(page).catch(() => ({}));
  proof = {
    failed: true,
    error: msg,
    finalUrl: page.url(),
    baseUrl: BASE_URL,
    apiUrl: API_URL,
    wsUrl: WS_URL,
    checkpoints,
    stepTimes,
    evidence,
  };
  console.error(msg);
} finally {
  fs.writeFileSync(`${outDir}/proof.json`, JSON.stringify(proof, null, 2));
  fs.writeFileSync(`${outDir}/console.log`, logs.join('\n'));
  await browser.close();
}

console.log(JSON.stringify(proof, null, 2));
