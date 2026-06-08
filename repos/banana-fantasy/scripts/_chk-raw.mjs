import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const w='0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const data = await (await fetch(`${API}/owner/${w}/draftToken/all`)).json();
console.log('=== sample RAW available records (admin) ===');
for (const t of (data.available||[]).slice(0,6)) {
  console.log(JSON.stringify({realTokenId:t.realTokenId, cardId:t._cardId??t.cardId, passType:t.passType, leagueId:t._leagueId??t.leagueId}));
}
console.log('\n=== sample RAW active records (admin) ===');
for (const t of (data.active||[]).slice(0,6)) {
  console.log(JSON.stringify({realTokenId:t.realTokenId, cardId:t._cardId??t.cardId, leagueId:t._leagueId??t.leagueId}));
}
// On-chain owner of 994 and 161 via contract
const RPC='https://mainnet.base.org';
const CONTRACT='0x14065412b3A431a660e6E576A14b104F1b3E463b';
async function ownerOf(id){
  const sel='0x6352211e';
  const data='0x6352211e'+BigInt(id).toString(16).padStart(64,'0');
  const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:CONTRACT,data},'latest']})});
  const j=await r.json();
  if(j.error||!j.result||j.result==='0x') return 'ERR:'+JSON.stringify(j.error||j.result);
  return '0x'+j.result.slice(26);
}
for (const id of ['994','161','359']) console.log(`on-chain owner of ${id}: ${await ownerOf(id)}`);
process.exit(0);
