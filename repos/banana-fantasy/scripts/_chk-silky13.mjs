#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W16 = '0x0173a84e8cd5d19cb3372814dde4c08b0852e013';
const W = '0x8d1ae27f10654d8f2604feae84485b84a7ad0da7';
for (const t of ['1649','1650','1651','1652','1653','1654','1655','1674']) {
  const d = await db.collection('draftTokens').doc(t).get();
  console.log(`draftTokens/${t}: created ${d.createTime?.toDate().toISOString()}  updated ${d.updateTime?.toDate().toISOString()}`);
}
console.log();
for (const t of ['1651','1652','1653','1654']) {
  const d = await db.doc(`owners/${W}/validDraftTokens/${t}`).get();
  console.log(`owners/W(silkyjohnson)/validDraftTokens/${t}: created ${d.createTime?.toDate().toISOString()}  updated ${d.updateTime?.toDate().toISOString()}`);
}
