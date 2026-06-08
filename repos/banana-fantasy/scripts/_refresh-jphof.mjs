import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});
const fs=admin.firestore();
const KEY=(readFileSync('.env.local','utf8').match(/^OPENSEA_API_KEY=(.*)$/m)||[])[1]?.replace(/['"]/g,'').trim();
const C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const snap=await fs.collection('marketplace_index').where('status','==','team').get();
const ids=[]; snap.forEach(d=>{const x=d.data();if(x.level==='jackpot'||x.level==='hof')ids.push(d.id);});
console.log('JP/HOF team ids:', ids.sort((a,b)=>a-b).join(','));
let ok=0;
for(const id of ids){try{const r=await fetch(`https://api.opensea.io/api/v2/chain/base/contract/${C}/nfts/${id}/refresh`,{method:'POST',headers:{accept:'application/json','x-api-key':KEY}});if(r.ok)ok++;}catch{} await sleep(500);}
console.log('refreshed',ok,'/',ids.length,'JP+HOF teams. OpenSea re-indexes async (~minutes).');
process.exit(0);
