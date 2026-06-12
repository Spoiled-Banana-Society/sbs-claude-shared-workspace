import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

// No composite index for periodNumber — use timestamp range instead (single-field
// indexes usually exist). Get all spins since period 1 activated (May 14).
let snap;
try {
  snap = await fs.collectionGroup('wheelSpins').where('timestamp', '>=', '2026-05-14T00:00:00Z').get();
} catch (e) {
  console.log('timestamp group query failed too:', e.message.slice(0, 250));
  process.exit(0);
}
console.log(`spins since May 14 (all wheelSpins subcollections): ${snap.size}`);
const rows = snap.docs.map(d => ({ ...d.data(), _path: d.ref.path }))
  .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
for (const s of rows.slice(-20)) {
  console.log(`${s.timestamp} result=${s.result} period=${s.periodNumber ?? '-'} idx=${s.spinIndex ?? s.spinIndexInPeriod ?? '-'}`);
}
const dist = {};
rows.forEach(r => { dist[r.result] = (dist[r.result] || 0) + 1; });
console.log('\ndistribution since May 14:', JSON.stringify(dist));
console.log('latest spin:', rows.at(-1)?.timestamp);
process.exit(0);
