import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const { FieldValue } = admin.firestore;

// --- on-chain supply cutoff ---
const RPC='https://mainnet.base.org', C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
const sup = await (await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:C,data:'0x18160ddd'},'latest']})})).json();
const maxId = (sup.result && sup.result!=='0x' ? Number(BigInt(sup.result)) : 1454) + 50;
console.log(`totalSupply cutoff maxId=${maxId}`);

// --- decoder (mirrors Go decodeOnchainTokenId / frontend recordTokenId) ---
function decodeId(cardId, realTokenId){
  const rt=String(realTokenId??'').trim(); if(/^\d+$/.test(rt)) return canon(rt);
  const c=String(cardId??'').trim();
  if(/^\d{1,7}$/.test(c)) return canon(c);
  if(/^\d{11,17}$/.test(c)) return canon(c.slice(10));
  return '';
}
// Canonicalize to the integer string — slice(10) of a synthetic cardId can yield
// LEADING-ZERO ids ("043"), which pass the numeric range check but never match
// String(n) in the write loop, so the team is dropped / mis-merged. Strip zeros.
function canon(s){ const n=Number(s); return Number.isInteger(n)&&n>0 ? String(n) : ''; }
function normLevel(raw){const v=String(raw??'').toLowerCase();if(v.includes('jackpot'))return'jackpot';if(v.includes('hall of fame')||v==='hof')return'hof';return'pro';}
function leagueNo(name){const h=String(name??'').match(/#\s*(\d+)/);if(h)return Number(h[1]);const s=String(name??'').trim().match(/^(?:bbb\s*)?(?:league\s*)?(\d+)$/i);return s?Number(s[1]):null;}

// --- scan global draftTokens, build authoritative TEAM map keyed by on-chain id ---
const snap = await fs.collection('draftTokens').get();
const teamMap = new Map(); // id -> {level, leagueNumber, fromReal}
let scanned=0, drafted=0;
snap.forEach(d=>{ scanned++;
  const x=d.data();
  const lid = x.LeagueId ?? x._leagueId ?? x.leagueId ?? '';
  if(!lid || String(lid).length===0) return; // not drafted = pass
  const rt = x.RealTokenId ?? x.realTokenId;
  const id = decodeId(x.CardId ?? x._cardId, rt);
  const n = Number(id); if(!(n>=1 && n<=maxId)) return;
  drafted++;
  const fromReal = /^\d+$/.test(String(rt??'').trim());
  const cur = teamMap.get(id);
  // TEAM-wins; prefer RealTokenId-decoded record on conflict
  if(!cur || (fromReal && !cur.fromReal)){
    teamMap.set(id, { level: normLevel(x.Level ?? x._level), leagueNumber: leagueNo(x.LeagueDisplayName ?? x._leagueDisplayName), fromReal });
  }
});
console.log(`scanned ${scanned} draftTokens; drafted(team, id<=maxId)=${drafted}; unique team ids=${teamMap.size}`);

// --- write authoritative status+level+league for every id 1..maxId (merge: preserves image/roster) ---
let batch=fs.batch(), w=0, teamW=0, passW=0;
for(let n=1;n<=maxId;n++){
  const id=String(n); const t=teamMap.get(id);
  const ref=fs.collection('marketplace_index').doc(id);
  if(t){ batch.set(ref,{tokenId:id,status:'team',level:t.level,leagueNumber:t.leagueNumber??null,updatedAt:FieldValue.serverTimestamp()},{merge:true}); teamW++; }
  else { batch.set(ref,{tokenId:id,status:'pass',level:'pro',updatedAt:FieldValue.serverTimestamp()},{merge:true}); passW++; }
  if(++w%400===0){ await batch.commit(); batch=fs.batch(); }
}
if(w%400!==0) await batch.commit();
console.log(`wrote ${w} index docs: team=${teamW} pass=${passW}`);

// --- verify by level ---
const byLvl={jackpot:0,hof:0,pro:0};
for(const t of teamMap.values()) byLvl[t.level]=(byLvl[t.level]||0)+1;
console.log('BACKEND drafted teams by level:', JSON.stringify(byLvl));
// the 12 jackpot finalize-doc ids: which are actually drafted (team) per backend?
const jp12=['479','750','882','954','994','1029','1051','1055','1064','1075','1081','1330'];
console.log('jackpot finalize ids → backend status:', jp12.map(id=>`${id}:${teamMap.has(id)?'TEAM('+teamMap.get(id).level+')':'pass'}`).join('  '));
process.exit(0);
