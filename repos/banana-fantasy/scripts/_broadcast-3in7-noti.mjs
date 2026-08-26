import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const TITLE = '3 JackHOF seats in the next 7 Drafts';
const MESSAGE = "Buy 2 Get 1 Free Spin for 7 more drafts\nEnter the Banana Zone for 7 more drafts\nJackHOF League — League winners go straight to the finals + compete for added prizes";
const [users, bots] = await Promise.all([
  db.collection('v2_users').select().get(),
  db.collection('botWallets').select().get(),
]);
const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
const wallets = users.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/i.test(w) && !botSet.has(w.toLowerCase()));
console.log('sending to', wallets.length);
let created = 0, skipped = 0, failed = 0;
for (const wallet of wallets) {
  try {
    await db.collection('marketplace_notifications').doc(`${wallet}__zone-3in7-0826`).create({
      wallet, type: 'promo', title: TITLE, message: MESSAGE, link: '/promos',
      dedupeKey: 'zone-3in7-0826', icon: '🍌', read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  } catch (e) {
    if (e?.code === 6 || /already exists/i.test(String(e))) { skipped++; continue; }
    failed++; console.error('FAIL', wallet, String(e).slice(0, 80));
  }
}
console.log(`done: created=${created} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
