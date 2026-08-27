#!/usr/bin/env node
// ONE-TIME bell: slow draft clock 8h → 4h + fresh clock at 5am (Richard 2026-08-26, live 5am PT Aug 27).
// Dedupe-safe: doc id `${wallet}__${KEY}` via .create() → re-running can NEVER double-send.
// Audience: every real v2_users wallet minus the botWallets registry. DRY unless APPLY=1.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const DRY = process.env.APPLY !== '1';
const KEY = 'slow-clock-4h-2026-08-27';
const bell = {
  type: 'promo',
  title: '⏱ Slow draft clocks change tomorrow',
  message: 'Starting 5am PT tomorrow, slow drafts move from 8 hours per pick to 4 hours. Kickoff is two weeks out and every draft needs to finish in time, so clocks will keep getting shorter as Week 1 gets closer. New rule too: if you are on the clock when the overnight pause hits, you get a fresh full clock at 5am PT. Set your queue before bed and you are good.',
  link: '/faq#drafts',
  icon: 'calendar',
};
const [users, bots] = await Promise.all([db.collection('v2_users').select().get(), db.collection('botWallets').select().get()]);
const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
const targets = users.docs.map((d) => d.id.toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w) && w !== '0x0000000000000000000000000000000000000000' && !botSet.has(w));
console.log(`v2_users=${users.size} bots=${botSet.size} targets=${targets.length} dry=${DRY}`);
if (DRY) { console.log('dry run — set APPLY=1 to send'); process.exit(0); }
const col = db.collection('marketplace_notifications');
const writer = db.bulkWriter();
writer.onWriteError((err) => err.code !== 6 && err.failedAttempts < 3);
let written = 0;
for (const wallet of targets) {
  void writer.create(col.doc(`${wallet}__${KEY}`), { wallet, ...bell, read: false, dedupeKey: KEY, createdAt: FieldValue.serverTimestamp() })
    .then(() => { written += 1; }).catch(() => {});
}
await writer.close();
console.log(`written=${written}`);
process.exit(0);
