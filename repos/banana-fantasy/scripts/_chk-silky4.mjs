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

// sample one activity event to learn field names
const sample = await db.collection('v2_activity_events').limit(1).get();
sample.forEach(s => console.log('SAMPLE activity event fields:', Object.keys(s.data()).join(', ')));

for (const field of ['wallet','walletAddress','user','owner','address']) {
  for (const w of [W16, W]) {
    try {
      const q = await db.collection('v2_activity_events').where(field, '==', w).limit(60).get();
      if (q.size > 0) {
        console.log(`\n=== v2_activity_events ${field}==${w} (${q.size})`);
        const rows = []; q.forEach(s => rows.push(s.data()));
        rows.sort((a,b)=>JSON.stringify(a.at||a.createdAt||a.ts||'').localeCompare(JSON.stringify(b.at||b.createdAt||b.ts||'')));
        rows.forEach(r => console.log(' ', JSON.stringify(r).slice(0,300)));
      }
    } catch(e) {}
  }
}
