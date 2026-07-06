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
const sampleD = await db.collection('v2_debug_events').limit(1).get();
sampleD.forEach(s => console.log('debug_events sample fields:', Object.keys(s.data()).join(', ')));
for (const field of ['wallet','userId','walletAddress']) {
  for (const [n,w] of [['16',W16],['main',W]]) {
    try {
      const q = await db.collection('v2_debug_events').where(field,'==',w).get();
      if (q.size) {
        console.log(`\n--- v2_debug_events ${field}==${n} (${q.size})`);
        const rows=[]; q.forEach(s=>rows.push(s.data()));
        rows.sort((a,b)=>String(a.at||a.ts||a.createdAtIso||'').localeCompare(String(b.at||b.ts||b.createdAtIso||'')));
        rows.slice(0,50).forEach(r=>console.log(' ', JSON.stringify(r).slice(0,260)));
      }
    } catch(e){}
  }
}
