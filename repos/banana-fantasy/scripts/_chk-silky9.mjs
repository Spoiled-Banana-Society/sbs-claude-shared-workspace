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

// social identities
const soc = await db.collection('web2_social_identities').get();
soc.forEach(s => {
  const j = JSON.stringify(s.data());
  if (j.toLowerCase().includes('0173a84e') || j.toLowerCase().includes('8d1ae27f') || /silky/i.test(j)) {
    console.log('web2_social_identities/', s.id, j.slice(0,300));
  }
});

// pass_origin docs for tokens 1649-1655
for (const t of ['1649','1650','1651','1652','1653','1654','1655']) {
  const d = await db.collection('pass_origin').doc(t).get();
  console.log(`pass_origin/${t}:`, d.exists ? JSON.stringify(d.data()).slice(0,250) : 'not found');
}

// owners docs
for (const w of [W16, W]) {
  const d = await db.collection('owners').doc(w).get();
  console.log(`\nowners/${w}:`, d.exists ? JSON.stringify(d.data()).slice(0,400) : 'not found');
}

// admin actions mentioning either wallet
const aa = await db.collection('v2_admin_actions').get();
aa.forEach(s => {
  const j = JSON.stringify(s.data());
  if (j.toLowerCase().includes('0173a84e') || j.toLowerCase().includes('8d1ae27f') || /silky/i.test(j)) {
    console.log('\nADMIN ACTION', s.id, j.slice(0,400));
  }
});
