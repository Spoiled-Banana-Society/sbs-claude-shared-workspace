import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
// known wallets
for(const [n,w] of [['Boris','0x438bbe98eed1dd2df244b007dab0583cc9be72e0'],['Richard','0x2e64db49fc597a731091471607f6cd0251d7eafb']]){
  const d=await fs.collection('owners').doc(w).collection('drafts').doc('rankings').get();
  console.log(`${n}: owners/${w.slice(0,8)}/drafts/rankings exists=${d.exists}`);
  if(d.exists){const r=d.data().Ranking||d.data().ranking||[];console.log('   len',r.length,'top',JSON.stringify(r.slice(0,2)));}
}
// count ALL user rankings docs via collectionGroup('drafts'), doc id 'rankings'
const cg=await fs.collectionGroup('drafts').get();
let total=0, withRank=0;
const samples=[];
cg.forEach(doc=>{ if(doc.id==='rankings'){ withRank++; const r=doc.data().Ranking||doc.data().ranking||[]; if(samples.length<3) samples.push(doc.ref.path+' len='+r.length); } });
console.log('\nTotal owners/*/drafts/rankings docs:', withRank);
samples.forEach(s=>console.log('  sample:',s));
process.exit(0);
