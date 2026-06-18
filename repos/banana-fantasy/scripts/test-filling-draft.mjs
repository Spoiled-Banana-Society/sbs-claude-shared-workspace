/**
 * Opens a headed Chrome browser with:
 * - Tab 1: Draft room (filling, 4/10)
 * - Tab 2: Drafting page (shows the same draft)
 *
 * After 20 seconds, fills the draft to 10/10 so you can watch the transition.
 */
import { chromium } from 'playwright';

const API_BASE = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const SITE_URL = 'https://banana-fantasy-sbs.vercel.app';

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  return res.json().catch(() => ({ _error: true, status: res.status }));
}

async function checkPage(page, label) {
  try {
    const url = page.url();
    const responsive = await page.evaluate(() => Date.now(), { timeout: 5000 });
    return { label, ok: true, url, responsive: true };
  } catch (err) {
    const url = page.url();
    return { label, ok: false, url, error: err.message?.slice(0, 100) };
  }
}

async function main() {
  // First create a fresh draft
  const wallet = '0xfill_' + Date.now();
  const tokenRand = Math.floor(Math.random() * 900000) + 200000;

  console.log('Minting for', wallet);
  await fetchJson(`${API_BASE}/owner/${wallet}/draftToken/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minId: tokenRand, maxId: tokenRand }),
  });

  const join = await fetchJson(`${API_BASE}/league/fast/owner/${wallet}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numLeaguesToJoin: 1 }),
  });
  const raw = Array.isArray(join) ? join[0] : join;
  const draftId = String(raw?._leagueId ?? raw?.draftId ?? raw?.leagueId ?? '');
  console.log('Draft ID:', draftId);

  // Add 3 bots (total 4/10)
  await fetchJson(
    `${API_BASE}/staging/fill-bots/fast?count=3&leagueId=${encodeURIComponent(draftId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  console.log('4/10 players ready');

  // Launch browser
  console.log('\nLaunching Chrome...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  // Track console errors
  const errors = [];

  // ===== Tab 1: Draft Room =====
  const draftRoom = await context.newPage();
  draftRoom.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[DR] ${msg.text().slice(0, 150)}`);
  });
  draftRoom.on('pageerror', err => errors.push(`[DR PAGE] ${err.message.slice(0, 150)}`));

  const draftRoomUrl = `${SITE_URL}/draft-room?id=${encodeURIComponent(draftId)}&name=${encodeURIComponent('BBB #1750')}&speed=fast&players=4&mode=live&wallet=${encodeURIComponent(wallet)}`;
  console.log('Opening draft room...');
  await draftRoom.goto(draftRoomUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  let check = await checkPage(draftRoom, 'DraftRoom');
  console.log(`  DraftRoom: ${check.ok ? 'OK' : 'FAIL'} url=${check.url?.slice(0, 80)} ${check.error || ''}`);

  // ===== Tab 2: Drafting Page =====
  const drafting = await context.newPage();
  drafting.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[DP] ${msg.text().slice(0, 150)}`);
  });
  drafting.on('pageerror', err => errors.push(`[DP PAGE] ${err.message.slice(0, 150)}`));

  console.log('Opening drafting page...');
  await drafting.goto(`${SITE_URL}/drafting?staging=true`, { waitUntil: 'networkidle', timeout: 30000 });

  // Set up auth + draft in localStorage
  await drafting.evaluate(({ wallet, draftId }) => {
    sessionStorage.setItem('sbs-staging-mode', 'true');
    localStorage.setItem('banana-user', JSON.stringify({
      walletAddress: wallet,
      username: 'TestUser',
      profilePicture: '',
      nflTeam: 'BUF',
      paidPasses: 5,
      freePasses: 3,
      isLoggedIn: true,
    }));
    const drafts = JSON.parse(localStorage.getItem('banana-active-drafts') || '[]');
    if (!drafts.some(d => d.id === draftId)) {
      drafts.push({
        id: draftId,
        contestName: 'BBB #1750',
        draftSpeed: 'fast',
        players: 4,
        status: 'filling',
        phase: 'filling',
        type: null,
        draftType: null,
        isYourTurn: false,
        currentPick: 0,
        liveWalletAddress: wallet,
        joinedAt: Date.now(),
        fillingStartedAt: Date.now(),
        fillingInitialPlayers: 4,
      });
      localStorage.setItem('banana-active-drafts', JSON.stringify(drafts));
    }
  }, { wallet, draftId });

  await drafting.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  check = await checkPage(drafting, 'Drafting');
  console.log(`  Drafting: ${check.ok ? 'OK' : 'FAIL'} url=${check.url?.slice(0, 80)} ${check.error || ''}`);

  // ===== Monitor filling phase (20 seconds) =====
  console.log('\n=== Monitoring filling phase (both tabs open) ===');
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const [dr, dp] = await Promise.all([
      checkPage(draftRoom, 'DraftRoom'),
      checkPage(drafting, 'Drafting'),
    ]);
    console.log(`  +${(i+1)*5}s: DR=${dr.ok ? 'OK' : 'FAIL'} DP=${dp.ok ? 'OK' : 'FAIL'} ${dr.error || ''} ${dp.error || ''}`);
  }

  // Check draft room content
  const drContent = await draftRoom.evaluate(() => {
    const el = document.querySelector('body');
    return el?.innerText?.slice(0, 300) || 'empty';
  }).catch(e => `ERROR: ${e.message?.slice(0, 80)}`);
  console.log('\nDraft room content:', drContent.replace(/\n/g, ' ').slice(0, 200));

  // ===== Fill to 10/10 =====
  console.log('\n=== Filling to 10/10 ===');
  await fetchJson(
    `${API_BASE}/staging/fill-bots/fast?count=6&leagueId=${encodeURIComponent(draftId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  console.log('6 more bots added');

  // ===== Watch transition (60 seconds) =====
  console.log('\n=== Watching 10/10 transition ===');
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const [dr, dp] = await Promise.all([
      checkPage(draftRoom, 'DraftRoom'),
      checkPage(drafting, 'Drafting'),
    ]);
    const elapsed = 20 + (i + 1) * 5;
    console.log(`  +${elapsed}s: DR=${dr.ok ? 'OK' : 'FAIL'} DP=${dp.ok ? 'OK' : 'FAIL'} ${dr.error || ''} ${dp.error || ''}`);
  }

  // Final content check
  const finalDrContent = await draftRoom.evaluate(() => {
    return document.body?.innerText?.slice(0, 300) || 'empty';
  }).catch(e => `ERROR: ${e.message?.slice(0, 80)}`);
  console.log('\nFinal draft room:', finalDrContent.replace(/\n/g, ' ').slice(0, 200));

  // Error summary
  console.log(`\n=== Errors: ${errors.length} ===`);
  const criticalErrors = errors.filter(e =>
    !e.includes('favicon') && !e.includes('manifest') && !e.includes('Firestore') &&
    !e.includes('firebase') && !e.includes('net::') && !e.includes('Failed to load resource') &&
    !e.includes('ResizeObserver') && !e.includes('Cross-Origin')
  );
  for (const e of criticalErrors.slice(0, 15)) {
    console.log(`  ${e}`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
