import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const rtdb = admin.database();
const fs = admin.firestore();

const wallet = '0xd3301bC039faF4223dA98bcEB5Fb81aBC9399362'.toLowerCase();
console.log(`Wallet: ${wallet}\n`);

// 1. What does the Go API return for this user's draft tokens?
console.log('=== 1. Go API /owner/.../draftToken/all (raw) ===');
const apiRes = await fetch(`https://sbs-drafts-api-staging-652484219017.us-central1.run.app/owner/${wallet}/draftToken/all`);
const apiData = await apiRes.json();
const active = apiData.active || [];
console.log(`  ${active.length} active tokens`);
// Show only ones that look like current/recent (sort by slot id desc)
const sorted = active.sort((a, b) => {
  const aSlot = parseInt((a._leagueId || a.leagueId || '').split('-').pop() || '0');
  const bSlot = parseInt((b._leagueId || b.leagueId || '').split('-').pop() || '0');
  return bSlot - aSlot;
});
for (const t of sorted.slice(0, 5)) {
  const lid = t._leagueId || t.leagueId;
  console.log(`  ${lid}  _leagueDisplayName="${t._leagueDisplayName}"  cardId=${t._cardId || t.cardId}`);
}

console.log('\n=== 2. Most recent drafts in RTDB (by pickEndTime) ===');
const snap = await rtdb.ref('drafts').once('value');
const all = snap.val() || {};
const recent = Object.entries(all)
  .filter(([_, d]) => d && typeof d === 'object' && (d.numPlayers || d.displayName))
  .map(([id, d]) => ({ id, numPlayers: d.numPlayers, displayName: d.displayName ?? '(MISSING)', pickEnd: d.realTimeDraftInfo?.pickEndTime || 0, startTime: d.realTimeDraftInfo?.draftStartTime || 0 }))
  .sort((a, b) => Math.max(b.pickEnd, b.startTime) - Math.max(a.pickEnd, a.startTime));
for (const r of recent.slice(0, 8)) {
  console.log(`  ${r.id}  numPlayers=${r.numPlayers}  displayName="${r.displayName}"  start=${new Date(r.startTime*1000).toISOString().slice(11,19)}`);
}

console.log('\n=== 3. Firestore "drafts" docs for these IDs ===');
for (const r of recent.slice(0, 5)) {
  const doc = await fs.collection('drafts').doc(r.id).get();
  if (!doc.exists) { console.log(`  ${r.id}: (no firestore doc)`); continue; }
  const d = doc.data();
  console.log(`  ${r.id}  DisplayName="${d.DisplayName || ''}"  Level="${d.Level || ''}"  NumPlayers=${d.NumPlayers}`);
}

console.log('\n=== 4. v2_leagueCounters / leagueCounts doc (the source of truth) ===');
const counters = await fs.collection('settings').doc('leagueCounts').get();
if (counters.exists) console.log('  ', counters.data());
else console.log('  (no settings/leagueCounts — checking other collections)');

const tracker = await fs.collection('settings').doc('seasonTracker').get();
if (tracker.exists) console.log('  seasonTracker:', tracker.data());

console.log('\n=== 5. Deployed Go API code check ===');
console.log('  Active rev:', (await import('child_process')).execSync('gcloud run services describe sbs-drafts-api-staging --region us-central1 --project sbs-staging-env --format="value(status.traffic[0].revisionName)" 2>&1').toString().trim());

process.exit(0);
