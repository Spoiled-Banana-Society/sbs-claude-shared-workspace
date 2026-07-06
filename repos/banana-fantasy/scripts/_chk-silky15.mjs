#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const TX = '0x86e28b81b3a4c1f5fd7a1031f7162445e6a740c8b5608764420c4b3adc3ecd93';
for (const col of ['v2_purchases']) {
  const q = await db.collection(col).where('txHash','==',TX).get();
  console.log(`${col} by txHash: ${q.size}`);
  q.forEach(s => console.log(' doc', s.id, 'created', s.createTime.toDate().toISOString(), 'updated', s.updateTime.toDate().toISOString(), '\n ', JSON.stringify(s.data()).slice(0,600)));
  // also any purchase docs for either wallet
  for (const w of ['0x0173a84e8cd5d19cb3372814dde4c08b0852e013','0x8d1ae27f10654d8f2604feae84485b84a7ad0da7']) {
    const q2 = await db.collection(col).where('userId','==',w).get();
    console.log(`\n${col} userId=${w}: ${q2.size}`);
    q2.forEach(s => console.log(' ', s.id, 'created', s.createTime.toDate().toISOString(), JSON.stringify(s.data()).slice(0,400)));
  }
}
