#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('/private/tmp/claude-501/-Users-richardvagner/b1126e60-8c25-44a1-89b1-ae240ddf1637/scratchpad/sbs.env','utf8');
const line = env.split('\n').find(l => l.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON='));
const sa = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}')+1));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const cols = await db.listCollections();
console.log('collections:', cols.map(c => c.id).join(', '));
