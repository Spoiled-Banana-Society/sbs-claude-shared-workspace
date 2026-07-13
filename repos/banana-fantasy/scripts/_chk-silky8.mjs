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

for (const t of ['1649','1650']) {
  const d = await db.collection('draftTokens').doc(t).get();
  const x = d.data();
  console.log(`\n=== draftTokens/${t}`);
  console.log('  OwnerId =', x.OwnerId);
  console.log('  LeagueId =', x.LeagueId, '| LeagueDisplayName =', x.LeagueDisplayName, '| DraftType =', x.DraftType, '| PassType =', x.PassType);
  const rosterCounts = Object.fromEntries(Object.entries(x.Roster||{}).map(([k,v])=>[k, (v||[]).length]));
  console.log('  Roster counts =', JSON.stringify(rosterCounts));
}

// all tokens owned by each wallet
for (const [name, w] of [['Silkyjohnson16', W16], ['Silkyjohnson', W]]) {
  const q = await db.collection('draftTokens').where('OwnerId', '==', w).get();
  const toks = []; q.forEach(s => { const d=s.data(); toks.push(`${s.id}(league=${d.LeagueId||'-'},${d.PassType})`); });
  console.log(`\n${name} owns ${q.size} draftTokens:`, toks.join(', '));
}

// tokens 1651-1654 owners
for (const t of ['1651','1652','1653','1654']) {
  const d = await db.collection('draftTokens').doc(t).get();
  console.log(`draftTokens/${t} OwnerId =`, d.exists ? d.data().OwnerId : 'missing');
}
