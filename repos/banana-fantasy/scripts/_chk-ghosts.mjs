import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
// Build a set of ALL realTokenIds currently held as AVAILABLE (undrafted pass) across the main test wallets
const wallets=['0x438bbe98eed1dd2df244b007dab0583cc9be72e0','0x2e64Db49fc597a731091471607F6CD0251d7EAFb'];
const availSet=new Set();
for(const w of wallets){
  const d=await (await fetch(`${API}/owner/${w.toLowerCase()}/draftToken/all`)).json();
  for(const t of (d.available||[])){const r=String(t.realTokenId??'');if(/^\d+$/.test(r))availSet.add(r);}
}
console.log(`available(pass) realTokenIds across test wallets: ${availSet.size}`);
// Index docs that are status=team + JP/HOF
const snap=await fs.collection('marketplace_index').where('status','==','team').get();
let total=0, jp=0,hof=0, jpGhost=0,hofGhost=0, jpGenuine=[],hofGenuine=[];
snap.forEach(d=>{const x=d.data();total++;
  if(x.level==='jackpot'){jp++; if(availSet.has(x.tokenId))jpGhost++; else jpGenuine.push(x.tokenId);}
  if(x.level==='hof'){hof++; if(availSet.has(x.tokenId))hofGhost++; else hofGenuine.push(x.tokenId);}
});
console.log(`index status=team total=${total}`);
console.log(`  JP: ${jp}  (currently-held-as-pass GHOST=${jpGhost}, genuine=${jpGenuine.length}: ${jpGenuine.join(',')})`);
console.log(`  HOF: ${hof} (currently-held-as-pass GHOST=${hofGhost}, genuine=${hofGenuine.length}: ${hofGenuine.join(',')})`);
process.exit(0);
