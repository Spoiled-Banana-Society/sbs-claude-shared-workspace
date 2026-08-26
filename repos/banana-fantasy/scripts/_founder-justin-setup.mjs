/**
 * Wed 8/26 Founder Draft with Justin Herzig (Boris 2026-08-25):
 * 1) founderSchedule/next → 9:30 PM ET this week (was 9:00)
 * 2) unpin the Felix bell, 3) pinned countdown bell for the founder draft.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const LIVE_AT_ISO = '2026-08-27T01:30:00.000Z'; // Wed 9:30 PM ET
const LIVE_AT = Date.parse(LIVE_AT_ISO);

// 1) schedule
await db.doc('founderSchedule/next').set({
  at: LIVE_AT_ISO,
  dayLabel: 'Wednesday at 9:30 PM ET',
  active: true,
  updatedAt: new Date().toISOString(),
}, { merge: true });
console.log('schedule → 9:30 PM ET Wed');

// 2) unpin Felix
const felix = await db.collection('marketplace_notifications').where('dedupeKey', '==', 'felix-stream-1hr').where('pinned', '==', true).get().catch(async () => await db.collection('marketplace_notifications').where('dedupeKey', '==', 'felix-stream-1hr').get());
let unpinned = 0;
for (const d of felix.docs) { if (d.get('pinned')) { await d.ref.update({ pinned: false }); unpinned++; } }
console.log('felix unpinned:', unpinned);

// 3) pinned Justin bell to all real users
const TITLE = 'Founder Draft with Justin Herzig';
const MESSAGE = "Founder Draft with Justin Herzig at 9:30 PM EST — Best Ball legend and advisor for the company.\nJoin with a paid pass at 9:30 and land in the Founder Draft — Founders badge for everyone in it, plus a Free Spin on paid entries.";
const [users, bots] = await Promise.all([
  db.collection('v2_users').select().get(),
  db.collection('botWallets').select().get(),
]);
const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
const wallets = users.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/i.test(w) && !botSet.has(w.toLowerCase()));
let created = 0, skipped = 0, failed = 0;
for (const wallet of wallets) {
  try {
    await db.collection('marketplace_notifications').doc(`${wallet}__founder-justin-0827`).create({
      wallet, type: 'promo', title: TITLE, message: MESSAGE,
      link: '/faq#founder-draft', dedupeKey: 'founder-justin-0827', icon: '👑',
      pinned: true, liveAtMs: LIVE_AT, read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  } catch (e) {
    if (e?.code === 6 || /already exists/i.test(String(e))) { skipped++; continue; }
    failed++; console.error('FAIL', wallet, String(e).slice(0, 80));
  }
}
console.log(`justin bell: created=${created} skipped=${skipped} failed=${failed} | liveAt=${LIVE_AT_ISO}`);
process.exit(0);
