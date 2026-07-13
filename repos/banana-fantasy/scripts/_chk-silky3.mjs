#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const W16 = '0x0173a84e8cd5d19cb3372814dde4c08b0852e013'; // Silkyjohnson16
const W = '0x8d1ae27f10654d8f2604feae84485b84a7ad0da7';   // Silkyjohnson

// user events for both wallets, last 2 days
for (const [name, w] of [['Silkyjohnson16', W16], ['Silkyjohnson', W]]) {
  console.log(`\n########## ${name} (${w}) — v2_user_events`);
  try {
    const ev = await db.collection('v2_user_events').where('wallet', '==', w).get();
    const rows = [];
    ev.forEach(s => rows.push(s.data()));
    rows.sort((a,b) => String(a.at||a.ts||a.createdAt).localeCompare(String(b.at||b.ts||b.createdAt)));
    for (const r of rows.slice(-40)) console.log(' ', JSON.stringify(r).slice(0,240));
    console.log('  total events:', rows.length);
  } catch(e) { console.log('  err', e.message); }
}

// pass_origin for both
for (const [name, w] of [['Silkyjohnson16', W16], ['Silkyjohnson', W]]) {
  console.log(`\n########## ${name} — pass_origin`);
  const po = await db.collection('pass_origin').where('wallet', '==', w).get();
  po.forEach(s => console.log(' ', s.id, JSON.stringify(s.data()).slice(0,240)));
  console.log('  count:', po.size);
}
