// Passes minted BEFORE go-live (2026-06-22 4:20 PM Pacific = 2026-06-22T23:20:00Z)
// Pulls all pass_purchased events + pass_origin docs on launch day, prints everything
// up to the cutoff so we can exclude them from the prize pool.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const CUTOFF = '2026-06-22T23:20:00'; // 4:20pm PDT in UTC ISO
const saJson = JSON.parse(fs.readFileSync(process.env.HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

console.log('=== pass_purchased events up to cutoff', CUTOFF, 'UTC ===');
const snap = await db.collection('v2_activity_events').where('type', '==', 'pass_purchased').get();
const rows = [];
for (const d of snap.docs) {
  const e = d.data();
  const iso = e.createdAtIso ?? '';
  if (iso < CUTOFF) rows.push(e);
}
rows.sort((a, b) => (a.createdAtIso ?? '').localeCompare(b.createdAtIso ?? ''));
let qty = 0, usd = 0;
for (const e of rows) {
  const q = Number(e.quantity) || 0;
  const paid = e.paymentMethod === 'usdc' || e.paymentMethod === 'card';
  if (paid) { qty += q; usd += q * 25; }
  console.log(`${(e.createdAtIso ?? '?').slice(0, 19)}  ${String(e.walletAddress ?? '?').slice(0, 14)}  qty=${q}  ${e.paymentMethod ?? '?'}${paid ? '' : '  (not counted — free/other)'}`);
}
console.log(`\nPAID before cutoff: ${qty} passes = $${usd}`);

console.log('\n=== pass_origin docs (free/admin mints) with launch-day timestamps ===');
const po = await db.collection('pass_origin').get();
const poRows = [];
for (const d of po.docs) {
  const e = d.data();
  const iso = e.createdAtIso ?? e.mintedAtIso ?? e.timestampIso ?? '';
  if (iso && iso < CUTOFF) poRows.push({ id: d.id, ...e, _iso: iso });
}
poRows.sort((a, b) => a._iso.localeCompare(b._iso));
for (const e of poRows) {
  console.log(`token ${e.id}  ${e._iso.slice(0, 19)}  ${String(e.wallet ?? '?').slice(0, 14)}  origin=${e.origin ?? e.type ?? '?'}`);
}
console.log(`\npass_origin docs before cutoff: ${poRows.length}`);

// Also show first few events AFTER cutoff for sanity (where does real traffic start)
console.log('\n=== first 10 paid events AFTER cutoff ===');
const after = snap.docs.map(d => d.data())
  .filter(e => (e.createdAtIso ?? '') >= CUTOFF && (e.paymentMethod === 'usdc' || e.paymentMethod === 'card'))
  .sort((a, b) => (a.createdAtIso ?? '').localeCompare(b.createdAtIso ?? ''))
  .slice(0, 10);
for (const e of after) console.log(`${(e.createdAtIso ?? '?').slice(0, 19)}  ${String(e.walletAddress ?? '?').slice(0, 14)}  qty=${Number(e.quantity) || 0}  ${e.paymentMethod}`);
