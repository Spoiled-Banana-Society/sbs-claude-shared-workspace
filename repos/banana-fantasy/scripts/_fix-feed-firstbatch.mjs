#!/usr/bin/env node
// One-field fix: realign merkle_rounds/1.firstBatchNumber to 1 so the live
// proof feed shows new drafts (#1+) again after the staging wipe reset the
// draft counter. No on-chain change; bookkeeping field only.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const ref = db.collection('merkle_rounds').doc('1');
const before = (await ref.get()).data() || {};
console.log('BEFORE: firstBatchNumber =', before.firstBatchNumber, '=> earliestMerkleDraft =', (before.firstBatchNumber-1)*100+1);
await ref.set({ firstBatchNumber: 1 }, { merge: true });
const after = (await ref.get()).data() || {};
console.log('AFTER:  firstBatchNumber =', after.firstBatchNumber, '=> earliestMerkleDraft =', (after.firstBatchNumber-1)*100+1);
console.log('Done — League #1 (draft 1) now passes the feed cutoff.');
process.exit(0);
