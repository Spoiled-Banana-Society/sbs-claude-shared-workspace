import admin from 'firebase-admin';import {readFileSync,writeFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const db=admin.firestore();
const CUTOFF=new Date("2026-06-23T12:10:00Z");
const TARGET=['BUF-QB','BAL-QB','CIN-RB2','BAL-RB2','MIA-RB2','GB-RB2','NYJ-RB2','IND-RB2','TEN-RB2','LAR-WR1','MIA-WR2','LV-WR2','CLE-WR2','NYJ-WR2','HOU-DST'];
const docs=await db.collection('drafts').listDocuments();
const ids=docs.map(d=>d.id).filter(id=>id!=='draftTracker');
const completed=[]; // {id, displayName, updateTime, picks:[{pid,pick,owner}]}
for(const id of ids){
  const s=await db.collection(`drafts/${id}/state`).doc('playerState').get();
  if(!s.exists) continue;
  const data=s.data()||{};
  const picks=Object.entries(data).filter(([k,e])=>e&&typeof e.PickNum==='number'&&e.PickNum>0).map(([k,e])=>({pid:k,pick:e.PickNum,owner:e.OwnerAddress}));
  if(picks.length<150) continue;
  if(s.updateTime && s.updateTime.toDate()<CUTOFF) continue;
  completed.push({id,updateTime:s.updateTime.toDate().toISOString(),picks});
  // per owner rosters
  const byOwner={}; for(const p of picks){(byOwner[p.owner] ||= []).push(p.pid);}
  for(const [o,ros] of Object.entries(byOwner)){
    const hit=TARGET.filter(t=>ros.includes(t)).length;
    if(hit>=12) console.log('MATCH',id,o,hit,'/15', s.updateTime.toDate().toISOString());
  }
}
console.log('completed post-cutoff drafts:',completed.length);
writeFileSync(process.env.OUT,JSON.stringify(completed));
process.exit(0);
