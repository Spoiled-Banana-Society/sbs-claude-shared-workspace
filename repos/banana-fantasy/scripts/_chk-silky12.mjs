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

// full payment debug events
const q = await db.collection('v2_debug_events').where('wallet','==',W16).get();
const rows=[]; q.forEach(s=>rows.push(s.data()));
rows.sort((a,b)=>String(a.serverTs).localeCompare(String(b.serverTs)));
for (const r of rows) console.log(r.serverTs, r.event, JSON.stringify(r.payload));

// failed mints
console.log('\n--- failed_mints');
const fm = await db.collection('failed_mints').get();
fm.forEach(s => {
  const j = JSON.stringify(s.data());
  if (/0173a84e|8d1ae27f/i.test(j)) console.log(s.id, j.slice(0,400));
});
console.log('failed_mints total docs:', fm.size);
