import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
initializeApp({ credential: cert(JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json','utf-8'))) });
const db = getFirestore();
const d = await db.doc('config/wheel').get();
if (!d.exists) { console.log('no config/wheel doc'); process.exit(0); }
const segs = d.data().segments || [];
const total = segs.reduce((s,x)=>s+(x.weight||0),0);
let evDirect = 0, pSpin = 0;
console.log('LIVE config/wheel segments:');
for (const s of segs) {
  const pct = ((s.weight||0)/total*100).toFixed(1);
  console.log(`  ${pct}%  "${s.label}"  type=${s.prizeType} val=${JSON.stringify(s.prizeValue)} w=${s.weight}`);
  const v = Number(s.prizeValue);
  if (s.prizeType === 'drafts' && Number.isFinite(v)) evDirect += v * (s.weight/total);
  if (s.prizeType === 'spins') pSpin += s.weight/total;
}
const ev = pSpin < 1 ? evDirect/(1-pSpin) : evDirect;
console.log(`\ntotal weight=${total}`);
console.log(`EV free drafts/spin direct=${evDirect.toFixed(3)}  incl re-spins(${(pSpin*100).toFixed(1)}%)=${ev.toFixed(3)}  + JP/HOF entry chances`);
console.log(`updatedAt=${d.data().updatedAt}`);
process.exit(0);
