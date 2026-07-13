#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const peek = async (c) => {
  const s = await db.collection(c).limit(1).get();
  if (s.empty) { console.log(`\n${c}: EMPTY`); return; }
  const d = s.docs[0];
  console.log(`\n${c}  (sample doc id: "${d.id}")`);
  const data = d.data();
  const keys = Object.keys(data).slice(0,12);
  for (const k of keys) {
    let v = data[k];
    if (typeof v === 'object') v = JSON.stringify(v).slice(0,50);
    console.log(`    ${k} = ${String(v).slice(0,60)}`);
  }
};
for (const c of ['cards','cardMetadata','playoffCards','playoffCardMetadata','2023DraftTokens','nft_league_map','leagues','scores','founderDrafts']) await peek(c);
process.exit(0);
