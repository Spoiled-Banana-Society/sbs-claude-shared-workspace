import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

// Spins since June 10, newest first
const snap = await fs.collection('wheelSpins')
  .where('timestamp', '>=', '2026-06-10T00:00:00Z')
  .orderBy('timestamp', 'desc').limit(40).get();
console.log(`=== spins since Jun 10 (${snap.size}) ===`);
console.log('(rebalance commit ~2026-06-12T00:34Z; period 1 closedAt 2026-06-12T00:59:06Z)');
for (const d of snap.docs) {
  const s = d.data();
  console.log(`${s.timestamp} result=${s.result} period=${s.periodNumber ?? '-'} idx=${s.spinIndex ?? '-'}`);
}

// Leaf doc shape
const leaves = await fs.collection('wheel_periods').doc('1').collection('leaves').limit(3).get();
console.log(`\n=== leaves sample (${leaves.size}) ===`);
leaves.docs.forEach(d => console.log(d.id, JSON.stringify(d.data()).slice(0, 200)));

// All period-1 spins (any date): how many spins carry periodNumber
const pspins = await fs.collection('wheelSpins').where('periodNumber', '==', 1).get().catch(e => { console.log('periodNumber query err:', e.message); return null; });
if (pspins) {
  console.log(`\n=== period-1 spins: ${pspins.size} ===`);
  const sorted = pspins.docs.map(d => d.data()).sort((a, b) => (a.spinIndex ?? 0) - (b.spinIndex ?? 0));
  for (const s of sorted.slice(-12)) console.log(`idx=${s.spinIndex} ${s.timestamp} result=${s.result}`);
}
process.exit(0);
