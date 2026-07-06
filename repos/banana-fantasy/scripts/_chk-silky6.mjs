#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W = '0x8d1ae27f10654d8f2604feae84485b84a7ad0da7';

for (const col of ['leagues','drafts']) {
  for (const id of ['2026-fast-draft-76','2026-fast-draft-78']) {
    const d = await db.collection(col).doc(id).get();
    if (!d.exists) { console.log(`${col}/${id}: NOT FOUND`); continue; }
    const data = d.data();
    console.log(`\n=== ${col}/${id}`);
    for (const [k,v] of Object.entries(data)) {
      const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      console.log(`  ${k} = ${s.length > 400 ? s.slice(0,400)+'…' : s}`);
    }
  }
}
