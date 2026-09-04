#!/usr/bin/env node
// ONE-TIME bell: slow draft clock 4h → 1h, pause end 7am → 9am PT, regular slow drafts closed to joining
// (Richard 2026-09-03 green light; live 9am PT Sep 4). Dedupe-safe: doc id `${wallet}__${KEY}` via .create().
// Audience: every real v2_users wallet minus botWallets. DRY unless APPLY=1.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const DRY = process.env.APPLY !== '1';
const KEY = 'slow-clock-1h-2026-09-04';
const bell = {
  type: 'promo',
  title: '⏱ Slow draft clocks go to 1 hour tomorrow',
  message: 'Slow draft clocks are now 1 hour per pick starting tomorrow at 9am PT. Clocks still pause overnight from 10pm to 9am PT and you get a fresh 1 hour clock at 9am. Regular slow drafts are no longer open to join. The last one is 8 of 10 and drafts at 1 hour once it fills. Going forward slow drafts are only in special leagues like Jackpot, JackHOF and HOF. Set your queue tonight so you never miss a pick.',
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
