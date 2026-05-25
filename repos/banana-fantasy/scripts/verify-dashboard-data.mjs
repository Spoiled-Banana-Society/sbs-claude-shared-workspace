import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

const now = new Date();
const todayIso = now.toISOString().slice(0, 10);
const week = new Date(now.getTime() - 7*24*3600*1000);
const weekIso = week.toISOString().slice(0, 10);

console.log(`Today: ${todayIso}  Week: ${weekIso}\n`);

const log = (label, val) => console.log(`  ${label.padEnd(40)} ${val}`);

// ─── USERS ────────────────────────────────────────────────────────────
console.log('═══ USERS ═══');
const usersSnap = await db.collection('v2_users').limit(50000).get();
log('total users', usersSnap.size);
let newToday = 0, newWeek = 0;
for (const d of usersSnap.docs) {
  const c = d.data().createdAt ?? '';
  if (c >= todayIso) newToday += 1;
  if (c >= weekIso) newWeek += 1;
}
log('new today', newToday);
log('new past week', newWeek);

// ─── USER EVENTS ──────────────────────────────────────────────────────
console.log('\n═══ USER EVENTS ═══');
const [signups, logins, promoClaims] = await Promise.all([
  db.collection('v2_user_events').where('eventType', '==', 'signup').limit(50000).get(),
  db.collection('v2_user_events').where('eventType', '==', 'login').limit(200000).get(),
  db.collection('v2_user_events').where('eventType', '==', 'promo_claimed').limit(50000).get(),
]);
log('signups lifetime', signups.size);
log('logins lifetime', logins.size);
log('promo claims lifetime', promoClaims.size);

let signupsToday = 0, loginsToday = 0, promoClaimsToday = 0;
for (const d of signups.docs) if ((d.data().timestamp ?? '') >= todayIso) signupsToday += 1;
for (const d of logins.docs) if ((d.data().timestamp ?? '') >= todayIso) loginsToday += 1;
for (const d of promoClaims.docs) if ((d.data().timestamp ?? '') >= todayIso) promoClaimsToday += 1;
log('signups today', signupsToday);
log('logins today', loginsToday);
log('promo claims today', promoClaimsToday);

// ─── PROMO BREAKDOWN ──────────────────────────────────────────────────
console.log('\n═══ PROMO BREAKDOWN (v2_user_events) ═══');
const promoByType = {};
for (const d of promoClaims.docs) {
  const data = d.data();
  const t = String(data.meta?.promoType ?? 'unknown');
  promoByType[t] = (promoByType[t] ?? 0) + 1;
}
for (const [type, n] of Object.entries(promoByType).sort((a, b) => b[1] - a[1])) {
  log(type, n);
}
log('SUM (should match lifetime)', Object.values(promoByType).reduce((s, n) => s + n, 0));

// ─── ACTIVITY EVENTS ──────────────────────────────────────────────────
console.log('\n═══ ACTIVITY EVENTS ═══');
const [purchases, enters, spinWons] = await Promise.all([
  db.collection('v2_activity_events').where('type', '==', 'pass_purchased').limit(50000).get(),
  db.collection('v2_activity_events').where('type', '==', 'draft_entered').limit(50000).get(),
  db.collection('v2_activity_events').where('type', '==', 'spin_won').limit(50000).get(),
]);
log('pass_purchased lifetime', purchases.size);
log('draft_entered lifetime', enters.size);
log('spin_won lifetime', spinWons.size);

let revenueTotal = 0, revenueToday = 0;
for (const d of purchases.docs) {
  const data = d.data();
  const price = Number(data.metadata?.totalPrice);
  if (!Number.isFinite(price)) continue;
  revenueTotal += price;
  if ((data.createdAtIso ?? '') >= todayIso) revenueToday += price;
}
log('revenue lifetime $', revenueTotal.toFixed(2));
log('revenue today $', revenueToday.toFixed(2));

let entersToday = 0;
for (const d of enters.docs) if ((d.data().createdAtIso ?? '') >= todayIso) entersToday += 1;
log('drafts entered today', entersToday);

// ─── WHEEL SPINS ──────────────────────────────────────────────────────
console.log('\n═══ WHEEL SPINS ═══');
const wsCount = await db.collectionGroup('wheelSpins').count().get();
const wsTotal = wsCount.data().count;
log('count() aggregation total', wsTotal);

const wsSnap = await db.collectionGroup('wheelSpins').limit(50000).get();
log('scan size (should match)', wsSnap.size);

let oneDraft=0, fiveDraft=0, tenDraft=0, twentyDraft=0, jp=0, hof=0, other=0;
let spinsTodayCount = 0, freeDraftsFromWheel = 0;
for (const d of wsSnap.docs) {
  const data = d.data();
  const prizeType = data.prize?.type ?? '';
  const prizeValue = data.prize?.value;
  const prizeAmount = data.prize?.amount;
  const tsIso = (typeof data.timestamp === 'string' ? data.timestamp : (typeof data.date === 'string' ? data.date : ''));
  if (tsIso >= todayIso) spinsTodayCount += 1;
  let n = null;
  if (prizeType === 'draft_pass' && typeof prizeValue === 'number') n = prizeValue;
  else if (prizeType === 'drafts' && typeof prizeAmount === 'number') n = prizeAmount;
  else if (prizeType === 'custom' && prizeValue === 'jackpot') jp += 1;
  else if (prizeType === 'custom' && prizeValue === 'hof') hof += 1;
  else if (prizeType === 'jackpot') jp += 1;
  else if (prizeType === 'hof') hof += 1;
  else other += 1;
  if (n === 1) { oneDraft += 1; freeDraftsFromWheel += 1; }
  else if (n === 5) { fiveDraft += 1; freeDraftsFromWheel += 5; }
  else if (n === 10) { tenDraft += 1; freeDraftsFromWheel += 10; }
  else if (n === 20) { twentyDraft += 1; freeDraftsFromWheel += 20; }
  else if (n !== null) other += 1;
}
log('1 free draft', oneDraft);
log('5 free drafts', fiveDraft);
log('10 free drafts', tenDraft);
log('20 free drafts', twentyDraft);
log('Jackpot entry', jp);
log('HOF entry', hof);
log('Other / unknown', other);
log('SUM (should match total)', oneDraft + fiveDraft + tenDraft + twentyDraft + jp + hof + other);
log('spins today', spinsTodayCount);
log('total free drafts from wheel', freeDraftsFromWheel);

// ─── WITHDRAWALS ──────────────────────────────────────────────────────
console.log('\n═══ WITHDRAWALS ═══');
for (const status of ['pending', 'approved', 'denied', 'paid', 'completed']) {
  const c = await db.collection('withdrawalRequests').where('status', '==', status).count().get();
  log(`status=${status}`, c.data().count);
}

// ─── PROMOS COLLECTIONGROUP ────────────────────────────────────────────
console.log('\n═══ PROMOS (per-user subcollection) ═══');
const promosCG = await db.collectionGroup('promos').limit(50000).get();
log('total docs', promosCG.size);
const promosByType = {};
const promosStarted = {};
const promosCompleted = {};
const promosPending = {};
for (const d of promosCG.docs) {
  const data = d.data();
  const t = String(data.type ?? 'unknown');
  promosByType[t] = (promosByType[t] ?? 0) + 1;
  const current = typeof data.progressCurrent === 'number' ? data.progressCurrent : 0;
  const max = typeof data.progressMax === 'number' ? data.progressMax : 0;
  const claimed = typeof data.claimCount === 'number' && data.claimCount > 0;
  const started = current > 0 || claimed;
  const completed = claimed;
  const isMultiStep = max > 1;
  const isPending = isMultiStep && started && !completed;
  if (started) promosStarted[t] = (promosStarted[t] ?? 0) + 1;
  if (completed) promosCompleted[t] = (promosCompleted[t] ?? 0) + 1;
  if (isPending) promosPending[t] = (promosPending[t] ?? 0) + 1;
}
console.log('  By type / started / completed / pending:');
for (const t of Object.keys(promosByType).sort()) {
  console.log(`    ${t.padEnd(20)} total=${String(promosByType[t]).padEnd(4)} started=${String(promosStarted[t] ?? 0).padEnd(4)} completed=${String(promosCompleted[t] ?? 0).padEnd(4)} pending=${promosPending[t] ?? 0}`);
}
