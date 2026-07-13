#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
// recent sales
const q = await db.collection('marketplace_activity').where('type','==','sale').limit(200).get().catch(()=>null);
console.log('sales found:', q ? q.size : 'query failed');
const rows = [];
if (q) q.forEach(s => rows.push(s.data()));
rows.sort((a,b)=>String(b.timestamp||b.createdAt||'').localeCompare(String(a.timestamp||a.createdAt||'')));
for (const r of rows.slice(0,5)) {
  const tid = String(r.tokenId ?? r.token_id ?? '');
  const d = await db.collection('draftTokens').doc(tid).get();
  console.log(`sale token ${tid}: seller=${(r.seller||r.from||'').slice(0,10)} buyer=${(r.buyer||r.to||'').slice(0,10)} ts=${r.timestamp||r.createdAt} | draftTokens.OwnerId=${d.exists ? (d.data().OwnerId||'').slice(0,10) : 'NO DOC'} leagueId=${d.exists ? d.data().LeagueId : '-'}`);
}
