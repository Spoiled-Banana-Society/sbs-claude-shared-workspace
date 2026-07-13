import admin from 'firebase-admin';import {readFileSync,writeFileSync} from 'fs';
const WRITE=process.argv.includes('--write');
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
const cg=await fs.collectionGroup('drafts').get();
const targets=[];const bak=[];let customized=0;
cg.forEach(doc=>{
  if(doc.id!=='rankings')return;
  const data=doc.data();const r=data.Ranking||data.ranking||[];
  // "customized" = top isn't the old default SF-RB1
  const top=(r[0]||{});const tp=top.PlayerId||top.playerId;
  if(tp && tp!=='SF-RB1') customized++;
  targets.push(doc.ref);bak.push({path:doc.ref.path,data});
});
console.log('user rankings docs:',targets.length,'| not old-default top (possible real edits):',customized);
if(!WRITE){console.log('DRY RUN — re-run with --write to backup+delete.');process.exit(0);}
const ts=new Date().toISOString().replace(/[:.]/g,'-');
writeFileSync(`${process.env.HOME}/sbs-rankings/backup/user-rankings.${ts}.json`,JSON.stringify(bak));
console.log('backed up ->',`~/sbs-rankings/backup/user-rankings.${ts}.json`);
let n=0;
for(let i=0;i<targets.length;i+=450){
  const b=fs.batch();targets.slice(i,i+450).forEach(ref=>b.delete(ref));await b.commit();n+=Math.min(450,targets.length-i);
  process.stdout.write(`\rdeleted ${n}/${targets.length}`);
}
console.log('\nDONE — all user rankings cleared. Everyone re-seeds from the new 2026 board.');
process.exit(0);
