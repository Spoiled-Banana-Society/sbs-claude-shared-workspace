import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
// Among CURRENT-contract ids (1..1454), which finalize docs are Jackpot/HOF, and how are they classified in the index?
const snap=await fs.collection('draftTokenMetadata').get();
const jpIds=[], hofIds=[];
snap.forEach(d=>{const n=Number(d.id);if(!(n>=1&&n<=1454))return;const a=(d.data().Attributes||[]);const r=a.filter(x=>/^(QB|RB|WR|TE|DST)\d+$/i.test(String(x.Trait_Type||x.trait_type||'')));if(r.length<10)return;const lvl=String((a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value||'').toLowerCase();if(lvl.includes('jackpot'))jpIds.push(d.id);else if(lvl.includes('hall of fame'))hofIds.push(d.id);});
console.log(`CURRENT-contract (id<=1454) finalize docs: Jackpot=${jpIds.length} HOF=${hofIds.length}`);
console.log('JP ids:', jpIds.join(','));
// index status for these JP ids
let team=0,pass=0,missing=0;
for(const id of jpIds){const x=await fs.collection('marketplace_index').doc(id).get();if(!x.exists){missing++;continue;}const s=x.data().status,l=x.data().level;if(s==='team'&&l==='jackpot')team++;else pass++;}
console.log(`of ${jpIds.length} JP finalize docs <=1454: indexed as jackpot-team=${team}, pass/other=${pass}, missing=${missing}`);
process.exit(0);
