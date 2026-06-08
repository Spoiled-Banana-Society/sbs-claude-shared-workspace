import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const S='https://banana-fantasy-sbs.vercel.app';

// 1) Count finalize docs (draftTokenMetadata) by LEVEL across ALL drafted tokens.
const snap = await fs.collection('draftTokenMetadata').get();
let jp=[], hof=[], pro=0, empty=0;
snap.forEach(d=>{
  const a=(d.data().Attributes||[]);
  const roster=a.filter(x=>/^(QB|RB|WR|TE|DST)\d+$/i.test(String(x.Trait_Type||x.trait_type||'')));
  if(roster.length<10){empty++;return;}
  const lvl=String((a.find(x=>String(x.Trait_Type||x.trait_type).toUpperCase()==='LEVEL')||{}).Value||'').toLowerCase();
  if(lvl.includes('jackpot'))jp.push(d.id); else if(lvl.includes('hall of fame')||lvl==='hof')hof.push(d.id); else pro++;
});
console.log(`draftTokenMetadata finalize docs: total=${snap.size} | JP=${jp.length} HOF=${hof.length} Pro=${pro} empty/pass=${empty}`);
console.log(`JP token ids: ${jp.join(',')}`);
console.log(`HOF token ids (first 30): ${hof.slice(0,30).join(',')}`);

// 2) For every JP doc, what does the LIVE metadata endpoint say RIGHT NOW (Team vs Pass) + LEVEL?
console.log(`\n--- Each JACKPOT finalize doc, live classification ---`);
for(const id of jp){
  try{
    const d=await(await fetch(`${S}/api/nft/metadata/${id}?cb=${Math.floor(performance.now())}`)).json();
    const st=(d.attributes||[]).find(a=>a.trait_type==='Status')?.value;
    const lv=(d.attributes||[]).find(a=>/^level$/i.test(a.trait_type))?.value || (d.attributes||[]).find(a=>a.trait_type==='LEVEL')?.value;
    console.log(`  token ${id}: ${st} | level=${lv||'?'} | name=${d.name}`);
  }catch(e){console.log(`  token ${id}: ERR ${e.message}`);}
}
process.exit(0);
