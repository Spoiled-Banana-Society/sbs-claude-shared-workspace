import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const w = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
for (const path of ['v2_users', 'owners']) {
  const d = await db.collection(path).doc(w).get();
  console.log(`\n${path}/${w} exists=${d.exists}`);
  if (d.exists) { const k = Object.keys(d.data()); console.log('keys:', k.join(', '));
    const x = d.data(); console.log('draftPasses=',x.draftPasses,'freeDrafts=',x.freeDrafts,'paidDrafts=',x.paidDrafts); }
}
// highest numeric token id in master to avoid collision
const all = await db.collection('draftTokens').get();
let max=0,cnt=0; all.forEach(d=>{ if(/^\d+$/.test(d.id)){const n=Number(d.id); if(n<1e12){cnt++; if(n>max)max=n;}}});
console.log('\nmaster draftTokens numeric(<1e12) count=',cnt,'max=',max);
process.exit(0);
