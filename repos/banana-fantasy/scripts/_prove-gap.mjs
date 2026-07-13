import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const S='https://banana-fantasy-sbs.vercel.app';
const sample=['10219','11000','11555','2121','5024','6868','8100','9930','3435','7645'];
console.log('token   | metadata endpoint        | in marketplace_index?');
for(const id of sample){
  const d=await(await fetch(`${S}/api/nft/metadata/${id}?cb=${Math.floor(performance.now())}`)).json();
  const st=(d.attributes||[]).find(a=>a.trait_type==='Status')?.value;
  const lv=(d.attributes||[]).find(a=>/^level$/i.test(a.trait_type))?.value;
  const idx=await fs.collection('marketplace_index').doc(id).get();
  const istat=idx.exists?`status=${idx.data().status} level=${idx.data().level}`:'NOT IN INDEX';
  console.log(`${id.padEnd(7)} | ${st}|${lv}`.padEnd(36)+`| ${istat}`);
}
// count numeric (real on-chain) JP/HOF finalize docs
const snap=await fs.collection('draftTokenMetadata').get();
let jpN=0,hofN=0; 
snap.forEach(d=>{ if(!/^\d{1,8}$/.test(d.id))return; const a=(d.data().Attributes||[]); const r=a.filter(x=>/^(QB|RB|WR|TE|DST)\d+$/i.test(String(x.Trait_Type||x.trait_type||''))); if(r.length<10)return; const lvl=String((a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value||'').toLowerCase(); if(lvl.includes('jackpot'))jpN++; else if(lvl.includes('hall of fame'))hofN++; });
console.log(`\nReal numeric on-chain JP/HOF finalize docs (≤8-digit ids): JP=${jpN} HOF=${hofN}`);
process.exit(0);
