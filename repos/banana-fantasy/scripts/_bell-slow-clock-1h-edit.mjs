#!/usr/bin/env node
// Edit the already-sent 1h slow-clock bell IN PLACE (same docs, dedupeKey slow-clock-1h-2026-09-04):
// Richard 2026-09-03 — the last regular slow lobby (BBB #168) filled, so drop the "8 of 10" sentence. DRY unless APPLY=1.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const DRY = process.env.APPLY !== '1';
const KEY = 'slow-clock-1h-2026-09-04';
const title = '⏱ Slow draft clocks go to 1 hour tomorrow';
const message = 'Slow draft clocks are now 1 hour per pick starting tomorrow at 9am PT. Clocks still pause overnight from 10pm to 9am PT and you get a fresh 1 hour clock at 9am. Regular slow drafts are no longer open to join. Going forward slow drafts are only in special leagues like Jackpot, JackHOF and HOF. Set your queue tonight so you never miss a pick.';
const snap = await db.collection('marketplace_notifications').where('dedupeKey', '==', KEY).get();
console.log(`docs=${snap.size} dry=${DRY}`);
if (DRY) process.exit(0);
const writer = db.bulkWriter();
let n = 0;
for (const d of snap.docs) { void writer.update(d.ref, { title, message }).then(() => { n += 1; }).catch(() => {}); }
await writer.close();
console.log(`updated=${n}`);
process.exit(0);
