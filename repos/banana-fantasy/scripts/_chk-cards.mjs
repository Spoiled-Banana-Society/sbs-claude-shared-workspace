#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env=readFileSync('.env.production','utf8');
const sa=JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({credential:cert(sa)});
const db=getFirestore();
const cards=await db.collection('drafts').doc('2024-fast-draft-0').collection('cards').get();
console.log('drafts/2024-fast-draft-0/cards:', cards.size, 'docs');
cards.docs.slice(0,3).forEach(d=>console.log('  card', d.id, '| CardId='+d.data().CardId, 'Level='+d.data().Level, 'owner='+(d.data().OwnerId||'').slice(0,8)));
const dt1=await db.collection('draftTokens').doc('1').get();
console.log('draftTokens/1:', dt1.exists ? JSON.stringify(dt1.data()).slice(0,120) : 'MISSING (wiped, not recreated)');
process.exit(0);
