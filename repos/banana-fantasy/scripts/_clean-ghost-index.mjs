import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const maxId = 1504; // totalSupply(1454)+50 margin
const snap = await fs.collection('marketplace_index').get();
// A doc is REAL iff its id is the canonical integer string of an on-chain token
// 1..maxId. Everything else = prior-era staging ghost (>maxId), leading-zero
// dupe ("043"), or junk → remove. Re-runnable: backfill rebuilds the real 1504.
const toDelete = [];
snap.forEach((d) => {
  const id = d.id; const n = Number(id);
  const real = String(n) === id && Number.isInteger(n) && n >= 1 && n <= maxId;
  if (!real) toDelete.push(id);
});
console.log('total docs=', snap.size, ' real-keep=', snap.size - toDelete.length, ' ghost-delete=', toDelete.length);
console.log('sample leading-zero deletes:', toDelete.filter((x) => String(Number(x)) !== x).slice(0, 10).join(','));
console.log('sample above-max deletes:', toDelete.filter((x) => Number(x) > maxId).slice(0, 5).join(','));
let batch = fs.batch(), w = 0, done = 0;
for (const id of toDelete) {
  batch.delete(fs.collection('marketplace_index').doc(id));
  if (++w % 400 === 0) { await batch.commit(); done += w; w = 0; batch = fs.batch(); process.stdout.write('.'); }
}
if (w > 0) { await batch.commit(); done += w; }
console.log('\ndeleted', done, 'ghost docs');
const after = await fs.collection('marketplace_index').get();
let team = 0, jp = 0, hof = 0, pro = 0, pass = 0;
after.forEach((d) => { const x = d.data(); if (x.status === 'team') { team++; const l = x.level; if (l === 'jackpot') jp++; else if (l === 'hof') hof++; else pro++; } else pass++; });
console.log('AFTER: total=', after.size, ' team=', team, '(jp=' + jp + ' hof=' + hof + ' pro=' + pro + ')', ' pass=', pass);
process.exit(0);
