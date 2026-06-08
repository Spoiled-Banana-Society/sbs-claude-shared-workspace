import admin from 'firebase-admin';import {readFileSync} from 'fs';
const sa=JSON.parse(readFileSync(process.env.SA_PATH,'utf8'));admin.initializeApp({credential:admin.credential.cert(sa)});const fs=admin.firestore();
// sample a few draftTokens docs — one drafted, one not — show raw field names
const snap = await fs.collection('draftTokens').limit(400).get();
let shownTeam=0, shownPass=0;
snap.forEach(d=>{
  const x=d.data();
  const lid = x.LeagueId ?? x._leagueId ?? x.leagueId;
  const isTeam = lid && String(lid).length>0;
  if(isTeam && shownTeam<2){shownTeam++;console.log('TEAM doc', d.id, '→ keys:', Object.keys(x).join(','));console.log('   ',JSON.stringify({CardId:x.CardId,_cardId:x._cardId,RealTokenId:x.RealTokenId,realTokenId:x.realTokenId,LeagueId:lid,Level:x.Level??x._level}));}
  if(!isTeam && shownPass<1){shownPass++;console.log('PASS doc', d.id, '→ keys:', Object.keys(x).join(','));console.log('   ',JSON.stringify({CardId:x.CardId,_cardId:x._cardId,RealTokenId:x.RealTokenId,realTokenId:x.realTokenId,Level:x.Level??x._level}));}
});
console.log(`(scanned 400; total collection size unknown)`);
process.exit(0);
