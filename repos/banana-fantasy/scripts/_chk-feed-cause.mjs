#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const tracker = (await db.collection('drafts').doc('draftTracker').get()).data() || {};
console.log('draftTracker.FilledLeaguesCount =', tracker.FilledLeaguesCount);
const mr = (await db.collection('merkle_rounds').doc('1').get()).data() || {};
console.log('merkle_rounds/1.firstBatchNumber =', mr.firstBatchNumber);
const earliest = mr.firstBatchNumber ? (mr.firstBatchNumber - 1) * 100 + 1 : null;
console.log('=> earliestMerkleDraft =', earliest);
console.log('=> feed shows drafts >= ', earliest, '; your League #1 is draft 1 =>', (1 >= (earliest||1) ? 'WOULD SHOW' : 'HIDDEN (this is the bug)'));
// what draft docs exist?
const drafts = await db.collection('drafts').get();
const real = drafts.docs.filter(d => d.id !== 'draftTracker');
console.log('draft docs present:', real.map(d=>d.id).slice(0,5), '(total', real.length, ')');
process.exit(0);
