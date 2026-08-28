#!/usr/bin/env node
// Edit the already-sent slow-clock bell IN PLACE (same docs, dedupeKey slow-clock-4h-2026-08-27):
// Richard 2026-08-26 moved the pause end from 5am to 7am PT. DRY unless APPLY=1.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const DRY = process.env.APPLY !== '1';
const KEY = 'slow-clock-4h-2026-08-27';
const title = '⏱ Slow draft clocks go from 8 to 4 hours tomorrow';
const message = 'Starting tomorrow morning, slow drafts move from 8 hours per pick to 4 hours, and the overnight pause now runs 10pm to 7am PT instead of 10pm to 5am. Kickoff is two weeks out and every draft needs to finish in time, so clocks will keep getting shorter as Week 1 gets closer. New rule too: if you are on the clock when the overnight pause hits, you get a fresh full clock at 7am PT. Set your queue before bed and you are good.';
const snap = await db.collection('marketplace_notifications').where('dedupeKey', '==', KEY).get();
console.log(`docs=${snap.size} dry=${DRY}`);
if (DRY) process.exit(0);
const writer = db.bulkWriter();
let n = 0;
for (const d of snap.docs) { void writer.update(d.ref, { title, message }).then(() => { n += 1; }).catch(() => {}); }
await writer.close();
console.log(`updated=${n}`);
process.exit(0);
