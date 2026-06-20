import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const db=admin.firestore();
const CUTOFF=new Date("2026-06-20T08:00:00Z");
const docs=await db.collection('drafts').listDocuments();
const ids=docs.map(d=>d.id).filter(id=>id!=='draftTracker');
let completed=0,before=0,after=0;
for(const id of ids){
  const s=await db.collection(`drafts/${id}/state`).doc('playerState').get();
  if(!s.exists) continue;
  const data=s.data()||{};
  const made=Object.values(data).filter(e=>e&&typeof e.PickNum==='number'&&e.PickNum>0).length;
  if(made<150) continue;
  completed++;
  if(s.updateTime && s.updateTime.toDate()<CUTOFF) before++; else after++;
}
console.log(`completed drafts: ${completed}  | before cutoff (SKIPPED): ${before}  | after cutoff (counted): ${after}`);
process.exit(0);
