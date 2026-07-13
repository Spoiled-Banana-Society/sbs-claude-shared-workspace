import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync(process.env.HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

console.log('=== pass_origin for tokens 0-35 ===');
for (let t = 0; t <= 35; t++) {
  const d = await db.collection('pass_origin').doc(String(t)).get();
  if (d.exists) {
    const e = d.data();
    console.log(`token ${t}: origin=${e.origin ?? e.type ?? JSON.stringify(e).slice(0, 100)} wallet=${(e.wallet ?? '?').slice(0, 12)}`);
  } else console.log(`token ${t}: (no pass_origin doc)`);
}

console.log('\n=== paid pass_purchased events 6/22–6/23 up to 23:20Z ===');
const snap = await db.collection('v2_activity_events').where('type', '==', 'pass_purchased').get();
const rows = snap.docs.map(d => d.data())
  .filter(e => { const i = e.createdAtIso ?? ''; return i >= '2026-06-22' && i < '2026-06-23T23:20:00'; })
  .sort((a, b) => (a.createdAtIso ?? '').localeCompare(b.createdAtIso ?? ''));
let paidQty = 0;
for (const e of rows) {
  const paid = e.paymentMethod === 'usdc' || e.paymentMethod === 'card';
  if (paid) paidQty += Number(e.quantity) || 0;
  console.log(`${(e.createdAtIso ?? '?').slice(0, 19)}  ${String(e.walletAddress ?? '?').slice(0, 14)}  qty=${e.quantity}  ${e.paymentMethod}`);
}
console.log(`\npaid qty in window: ${paidQty}`);
