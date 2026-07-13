#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const B = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const u = await db.collection('v2_users').doc(B).get();
const d = u.data() || {};
// Show every numeric / pass-ish field on the user doc
console.log('Boris user doc pass/draft/free fields:');
for (const [k,v] of Object.entries(d)) {
  if (/draft|pass|free|credit|spin|token|count|ticket/i.test(k) || typeof v === 'number') {
    console.log(`  ${k} = ${typeof v === 'object' ? JSON.stringify(v).slice(0,60) : v}`);
  }
}
// How many users have freeDrafts > 0?
const all = await db.collection('v2_users').get();
let withFree = 0, totalFree = 0;
all.forEach(s => { const f = s.data().freeDrafts; if (typeof f === 'number' && f > 0) { withFree++; totalFree += f; } });
console.log(`\nAcross all users: ${withFree} accounts have freeDrafts>0, total ${totalFree} free drafts`);
process.exit(0);
