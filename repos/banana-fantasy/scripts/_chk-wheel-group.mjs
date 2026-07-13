import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

// Collection-group: all wheelSpins subcollections (and the top-level one)
let snap;
try {
  snap = await fs.collectionGroup('wheelSpins').where('periodNumber', '==', 1).get();
  console.log(`period-1 spins via collectionGroup: ${snap.size}`);
} catch (e) {
  console.log('group query needs index?', e.message.slice(0, 200));
  process.exit(0);
}
const rows = snap.docs.map(d => ({ ...d.data(), _path: d.ref.path }))
  .sort((a, b) => (a.spinIndex ?? a.spinIndexInPeriod ?? 0) - (b.spinIndex ?? b.spinIndexInPeriod ?? 0));
for (const s of rows.slice(-15)) {
  console.log(`idx=${s.spinIndex ?? s.spinIndexInPeriod} ${s.timestamp} result=${s.result} path=${s._path.split('/').slice(0,2).join('/')}`);
}
console.log('\nlast spin timestamp overall:', rows.map(r => r.timestamp).sort().at(-1));
console.log('first:', rows.map(r => r.timestamp).sort()[0]);
// Distribution sanity for period spins
const dist = {};
rows.forEach(r => { dist[r.result] = (dist[r.result] || 0) + 1; });
console.log('result distribution:', JSON.stringify(dist));
process.exit(0);
