import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const S='https://banana-fantasy-sbs.vercel.app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// collect numeric HOF finalize-doc ids
const snap=await fs.collection('draftTokenMetadata').get();
const ids=[];
snap.forEach(d=>{ if(!/^\d{1,8}$/.test(d.id))return; const a=(d.data().Attributes||[]); const r=a.filter(x=>/^(QB|RB|WR|TE|DST)\d+$/i.test(String(x.Trait_Type||x.trait_type||''))); if(r.length<10)return; const lvl=String((a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value||'').toLowerCase(); if(lvl.includes('hall of fame'))ids.push(d.id); });
console.log(`reading ${ids.length} HOF teams to stamp the index...`);
let team=0,pass=0,err=0;
for(let i=0;i<ids.length;i++){
  let st=null;
  for(let a=0;a<2&&st===null;a++){ try{const d=await(await fetch(`${S}/api/nft/metadata/${ids[i]}?cb=${ids[i]}-${a}-${Math.floor(performance.now())}`)).json(); st=(d.attributes||[]).find(x=>x.trait_type==='Status')?.value;}catch{st=null; await sleep(300);} }
  if(st==='Team')team++; else if(st==='Draft Pass')pass++; else err++;
  await sleep(140);
  if((i+1)%80===0)process.stdout.write(`  ${i+1}/${ids.length} (team=${team} pass=${pass})\r`);
}
console.log(`\ndone: team=${team} pass=${pass} err=${err}`);
const after=await fs.collection('marketplace_index').where('status','==','team').where('level','==','hof').get();
console.log(`marketplace_index HOF teams now: ${after.size}`);
process.exit(0);
