import admin from 'firebase-admin';import {readFileSync,writeFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});
const fs=admin.firestore();
console.log('project:', sa.project_id);
const ts=new Date().toISOString().replace(/[:.]/g,'-');
for(const id of ['playerMap','rankings','defaultPlayerDraftState']){
  const d=await fs.collection('playerStats2026').doc(id).get();
  if(!d.exists){console.log(id,'-> MISSING');continue;}
  const data=d.data();
  writeFileSync(`${process.env.HOME}/sbs-rankings/backup/${id}.${ts}.json`, JSON.stringify(data));
  if(id==='playerMap'){
    const P=data.Players||{};const keys=Object.keys(P);
    console.log('playerMap.Players count:', keys.length);
    console.log('sample keys:', keys.slice(0,6).join(', '));
    console.log('sample StatsObject (',keys[0],'):', JSON.stringify(P[keys[0]]));
  } else if(id==='rankings'){
    const R=data.Ranking||data.ranking||[];
    console.log('rankings length:', R.length, '| sample:', JSON.stringify(R.slice(0,2)));
  } else {
    console.log('defaultPlayerDraftState top keys:', Object.keys(data).slice(0,8).join(', '));
  }
}
console.log('backup -> ~/sbs-rankings/backup/ ('+ts+')');
process.exit(0);
