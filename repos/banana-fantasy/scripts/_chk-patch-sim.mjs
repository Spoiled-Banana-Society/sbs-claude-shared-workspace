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
// simulate engineCreditsWalletUnsold(W, '1649')
const doc = await db.collection('draftTokens').doc('1649').get();
const ownerId = String(doc.data()?.OwnerId ?? '').toLowerCase();
const trades = await db.collection('marketplace_activity').where('walletAddress','==',W).get();
const sells = new Set(); trades.forEach(s=>{const d=s.data(); if(d.type==='sell'||d.type==='offer_accepted') sells.add(String(d.tokenId));});
console.log('OwnerId match:', ownerId === W, '| activity docs:', trades.size, '| sold 1649:', sells.has('1649'));
console.log('=> route would now return notOwned WITHOUT 2026-fast-draft-76:', ownerId === W && !sells.has('1649'));
