import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const { FieldValue } = admin.firestore;
const S='https://banana-fantasy-sbs.vercel.app';
const KEY=(readFileSync('.env.local','utf8').match(/^OPENSEA_API_KEY=(.*)$/m)||[])[1]?.replace(/['"]/g,'').trim();
const C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function decodeId(c,r){const rt=String(r??'').trim();if(/^\d+$/.test(rt))return rt;const x=String(c??'').trim();if(/^\d{1,7}$/.test(x))return x;if(/^\d{11,17}$/.test(x))return x.slice(10);return'';}
function normLevel(v){v=String(v??'').toLowerCase();if(v.includes('jackpot'))return'jackpot';if(v.includes('hall of fame')||v==='hof')return'hof';return'pro';}
function leagueNo(n){const h=String(n??'').match(/#\s*(\d+)/);if(h)return Number(h[1]);const s=String(n??'').trim().match(/^(?:bbb\s*)?(?:league\s*)?(\d+)$/i);return s?Number(s[1]):null;}

// 1) wait for resolveCard index-first deploy: a STABLE team id should read Team.
//    Use 882 — re-set it to team first, then poll; old code would flip it to pass on read, new code keeps Team.
const sup=await(await fetch('https://mainnet.base.org',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:C,data:'0x18160ddd'},'latest']})})).json();
const maxId=(sup.result&&sup.result!=='0x'?Number(BigInt(sup.result)):1454)+50;

async function buildTeamMap(){
  const snap=await fs.collection('draftTokens').get();
  const m=new Map();
  snap.forEach(d=>{const x=d.data();const lid=x.LeagueId??x._leagueId??'';if(!lid)return;const rt=x.RealTokenId??x.realTokenId;const id=decodeId(x.CardId??x._cardId,rt);const n=Number(id);if(!(n>=1&&n<=maxId))return;const fromReal=/^\d+$/.test(String(rt??'').trim());const cur=m.get(id);if(!cur||(fromReal&&!cur.fromReal))m.set(id,{level:normLevel(x.Level??x._level),leagueNumber:leagueNo(x.LeagueDisplayName??x._leagueDisplayName),fromReal});});
  return m;
}
async function applyBackfill(m){let b=fs.batch(),w=0;for(let n=1;n<=maxId;n++){const id=String(n),t=m.get(id),ref=fs.collection('marketplace_index').doc(id);if(t)b.set(ref,{tokenId:id,status:'team',level:t.level,leagueNumber:t.leagueNumber??null,updatedAt:FieldValue.serverTimestamp()},{merge:true});else b.set(ref,{tokenId:id,status:'pass',level:'pro',updatedAt:FieldValue.serverTimestamp()},{merge:true});if(++w%400===0){await b.commit();b=fs.batch();}}if(w%400)await b.commit();}

// poll for deploy: set 882=team, then read metadata; new code returns Team, old flips to pass
let live=false;
for(let i=0;i<40;i++){
  await fs.collection('marketplace_index').doc('882').set({status:'team',level:'jackpot',tokenId:'882'},{merge:true});
  await sleep(2000);
  const d=await(await fetch(`${S}/api/nft/metadata/882?cb=${i}-${Date.now()}`)).json();
  const st=(d.attributes||[]).find(a=>a.trait_type==='Status')?.value;
  if(st==='Team'){live=true;console.log(`deploy live after ~${i*15}s (882=Team)`);break;}
  await sleep(13000);
}
if(!live){console.log('deploy not detected in 10min — aborting (will not re-corrupt)');process.exit(1);}

// 2) re-apply backfill (locks in truth now that resolveCard is index-first)
const m=await buildTeamMap();
await applyBackfill(m);
const byLvl={jackpot:0,hof:0,pro:0};for(const t of m.values())byLvl[t.level]++;
console.log('re-applied. backend teams by level:',JSON.stringify(byLvl));

// 3) heal JP+HOF rosters/images via the (now index-first) metadata route
const jpHof=[...m.entries()].filter(([,t])=>t.level==='jackpot'||t.level==='hof').map(([id])=>id);
console.log(`healing ${jpHof.length} JP+HOF teams via metadata...`);
let healed=0;
for(const id of jpHof){try{const d=await(await fetch(`${S}/api/nft/metadata/${id}?cb=${id}-${Date.now()}`)).json();if((d.attributes||[]).find(a=>a.trait_type==='Status')?.value==='Team')healed++;}catch{}await sleep(120);}
console.log(`healed ${healed}/${jpHof.length}`);

// 4) OpenSea refresh real range
if(KEY){console.log('refreshing OpenSea 1..maxId...');let ok=0;for(let i=1;i<=Math.min(maxId,1460);i+=4){const b=[i,i+1,i+2,i+3].filter(x=>x<=1460);const r=await Promise.all(b.map(async id=>{try{return (await fetch(`https://api.opensea.io/api/v2/chain/base/contract/${C}/nfts/${id}/refresh`,{method:'POST',headers:{accept:'application/json','x-api-key':KEY}})).ok;}catch{return false;}}));ok+=r.filter(Boolean).length;await sleep(350);}console.log(`opensea refresh ok=${ok}`);}

// 5) verify live
await sleep(3000);
const stats=await(await fetch(`${S}/api/marketplace/stats`)).json();
const jpN=(await(await fetch(`${S}/api/marketplace/teams?level=jackpot`)).json()).nfts.length;
const hofN=(await(await fetch(`${S}/api/marketplace/teams?level=hof`)).json()).nfts.length;
console.log('FINAL live: stats=',JSON.stringify(stats),' jackpot-filter=',jpN,' hof-filter=',hofN);
process.exit(0);
