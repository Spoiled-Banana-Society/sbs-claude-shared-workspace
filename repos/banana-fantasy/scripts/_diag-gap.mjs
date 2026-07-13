import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));
admin.initializeApp({credential:admin.credential.cert(sa)});
const fs=admin.firestore();
const maxId=1504;
function decodeId(cardId, realTokenId){
  const rt=String(realTokenId??'').trim(); if(/^\d+$/.test(rt)) return rt;
  const c=String(cardId??'').trim();
  if(/^\d{1,7}$/.test(c)) return c;
  if(/^\d{11,17}$/.test(c)) return c.slice(10);
  return '';
}
function normLevel(raw){const v=String(raw??'').toLowerCase();if(v.includes('jackpot'))return'jackpot';if(v.includes('hall of fame')||v==='hof')return'hof';return'pro';}
const snap=await fs.collection('draftTokens').get();
const teamMap=new Map();
snap.forEach(d=>{const x=d.data();const lid=x.LeagueId??x._leagueId??'';if(!lid||String(lid).length===0)return;
  const rt=x.RealTokenId??x.realTokenId;const id=decodeId(x.CardId??x._cardId,rt);const n=Number(id);if(!(n>=1&&n<=maxId))return;
  const fromReal=/^\d+$/.test(String(rt??'').trim());const cur=teamMap.get(id);
  if(!cur||(fromReal&&!cur.fromReal))teamMap.set(id,{level:normLevel(x.Level??x._level),fromReal});});
// find keys whose canonical form differs (leading zeros) OR collide
let leadingZero=0; const canonCollisions=new Map();
for(const k of teamMap.keys()){
  const canon=String(Number(k));
  if(canon!==k){leadingZero++; console.log('NON-CANONICAL key:',JSON.stringify(k),'->',canon,'level',teamMap.get(k).level);}
  canonCollisions.set(canon,(canonCollisions.get(canon)||0)+1);
}
const dupes=[...canonCollisions.entries()].filter(([k,v])=>v>1);
console.log('teamMap.size=',teamMap.size,'non-canonical keys=',leadingZero,'canonical-collisions=',dupes.length);
// how many unique CANONICAL ids actually in 1..1504
const canonSet=new Set([...teamMap.keys()].map(k=>String(Number(k))));
console.log('unique canonical ids=',canonSet.size);
// level breakdown by canonical (TEAM-wins, prefer real already applied but recompute by canonical)
process.exit(0);
