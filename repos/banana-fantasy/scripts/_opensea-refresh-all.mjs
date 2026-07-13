import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const KEY = (readFileSync('.env.local','utf8').match(/^OPENSEA_API_KEY=(.*)$/m)||[])[1]?.replace(/['"]/g,'').trim();
const C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(!KEY){console.log('no OPENSEA_API_KEY');process.exit(1);}

// All real numeric token ids that were ever drafted (these are the ones OpenSea
// shows stale pass/team/names for). Refreshing makes OpenSea re-read our
// now-correct metadata endpoint.
const snap = await fs.collection('draftTokenMetadata').get();
const ids = [];
snap.forEach(d=>{ if(/^\d{1,8}$/.test(d.id)) ids.push(d.id); });
ids.sort((a,b)=>Number(b)-Number(a)); // newest first (most visible)
console.log(`refreshing ${ids.length} OpenSea tokens (concurrency 4, paced)...`);

let ok=0, fail=0;
for(let i=0;i<ids.length;i+=4){
  const batch=ids.slice(i,i+4);
  const res=await Promise.all(batch.map(async id=>{
    try{const r=await fetch(`https://api.opensea.io/api/v2/chain/base/contract/${C}/nfts/${id}/refresh`,{method:'POST',headers:{accept:'application/json','x-api-key':KEY}});return r.ok;}catch{return false;}
  }));
  ok+=res.filter(Boolean).length; fail+=res.filter(x=>!x).length;
  await sleep(350);
  if((i+4)%400===0)process.stdout.write(`  ${i+4}/${ids.length} (ok=${ok} fail=${fail})\r`);
}
console.log(`\ndone: refreshed ok=${ok} fail=${fail} of ${ids.length}. OpenSea re-indexes asynchronously over the next several minutes.`);
process.exit(0);
