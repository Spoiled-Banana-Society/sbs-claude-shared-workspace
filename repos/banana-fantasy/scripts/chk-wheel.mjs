import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
initializeApp({ credential: cert(JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json','utf-8'))) });
const db = getFirestore();
const d = await db.collection('wheel_config').doc('active').get();
if (!d.exists) { console.log('no live wheel_config/active'); process.exit(0); }
const segs = d.data().segments || [];
const total = segs.reduce((s,x)=>s+(x.weight||0),0);
let evDraftsDirect = 0, pSpin = 0;
console.log('LIVE wheel segments:');
for (const s of segs) {
  const pct = ((s.weight||0)/total*100).toFixed(1);
  console.log(`  ${pct}%  ${s.label}  (type=${s.prizeType} val=${s.prizeValue} w=${s.weight})`);
  if (s.prizeType === 'drafts') evDraftsDirect += (Number(s.prizeValue)||0) * (s.weight/total);
  if (s.prizeType === 'spins') pSpin += s.weight/total;
}
const evWithRespin = pSpin < 1 ? evDraftsDirect/(1-pSpin) : evDraftsDirect;
console.log(`\ntotal weight = ${total}`);
console.log(`EV free drafts per spin (direct) = ${evDraftsDirect.toFixed(3)}`);
console.log(`EV free drafts per spin (incl. re-spins, ${(pSpin*100).toFixed(1)}% chance) = ${evWithRespin.toFixed(3)}`);
console.log('...plus the chance at jackpot/HOF entries (worth more than a draft).');
process.exit(0);
