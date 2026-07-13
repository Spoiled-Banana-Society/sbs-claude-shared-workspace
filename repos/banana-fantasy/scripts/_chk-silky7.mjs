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

// draftTokens for the interesting token ids
for (const t of ['1649','1650','1651','1655','1674','1675']) {
  const d = await db.collection('draftTokens').doc(t).get();
  console.log(`draftTokens/${t}:`, d.exists ? JSON.stringify(d.data()).slice(0,300) : 'NOT FOUND');
}

// draftStatus for draft-76
for (const col of ['draftStatus']) {
  const d = await db.collection(col).doc('2026-fast-draft-76').get();
  console.log(`\n${col}/2026-fast-draft-76:`, d.exists ? JSON.stringify(d.data()).slice(0,600) : 'NOT FOUND');
}

// sample a draftTokens doc to learn schema
const s = await db.collection('draftTokens').limit(1).get();
s.forEach(x => console.log('\nsample draftTokens doc id', x.id, 'fields:', Object.keys(x.data()).join(', ')));
