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

for (const [name, w] of [['Silkyjohnson16', W16], ['Silkyjohnson', W]]) {
  const q = await db.collection('v2_activity_events').where('walletAddress', '==', w).get();
  const rows = []; q.forEach(s => rows.push(s.data()));
  rows.sort((a,b)=>String(a.createdAtIso).localeCompare(String(b.createdAtIso)));
  console.log(`\n##### ${name} timeline (${rows.length} events, times UTC):`);
  for (const r of rows) {
    console.log(`  ${r.createdAtIso}  ${r.type}  pay=${r.paymentMethod} qty=${r.quantity} tokens=${JSON.stringify(r.tokenIds)} meta=${JSON.stringify(r.metadata)}`.slice(0,320));
  }
}
