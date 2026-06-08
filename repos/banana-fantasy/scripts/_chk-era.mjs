import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const w='0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const data = await (await fetch(`${API}/owner/${w}/draftToken/all`)).json();
const avail=(data.available||[]).map(t=>String(t.realTokenId??'')).filter(x=>/^\d+$/.test(x)).map(Number).sort((a,b)=>a-b);
console.log(`admin available realTokenIds: count=${avail.length} min=${avail[0]} max=${avail[avail.length-1]}`);
console.log(`first 20: ${avail.slice(0,20).join(',')}`);
console.log(`contiguous? gaps:`, (()=>{let g=0;for(let i=1;i<avail.length;i++)if(avail[i]!==avail[i-1]+1)g++;return g;})());
// finalize-doc league names + levels for a sample of admin's available ids
console.log('\nFinalize docs for admin available ids (prior-era artifacts?):');
let jp=0,hof=0,pro=0,nodoc=0;
for(const id of avail){
  const m=await fs.collection('draftTokenMetadata').doc(String(id)).get();
  if(!m.exists){nodoc++;continue;}
  const a=(m.data().Attributes||[]);
  const lvl=(a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value||'Pro';
  if(/jackpot/i.test(lvl))jp++;else if(/hall of fame|hof/i.test(lvl))hof++;else pro++;
}
console.log(`  of ${avail.length} available passes: JP-doc=${jp} HOF-doc=${hof} Pro-doc=${pro} noDoc=${nodoc}`);
// sample league names
for(const id of [avail[0],avail[1],avail[Math.floor(avail.length/2)],avail[avail.length-1]]){
  const m=await fs.collection('draftTokenMetadata').doc(String(id)).get();
  const a=m.exists?(m.data().Attributes||[]):[];
  const ln=(a.find(x=>/league-?name/i.test(String(x.Trait_Type||x.trait_type)))||{}).Value||'(none)';
  const lvl=(a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value||'(none)';
  console.log(`  id ${id}: level=${lvl} league="${ln}"`);
}
process.exit(0);
