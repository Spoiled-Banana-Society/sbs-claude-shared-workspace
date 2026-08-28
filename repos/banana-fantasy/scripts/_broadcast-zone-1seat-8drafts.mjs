/**
 * One-time broadcast: 1 JackHOF seat / 8 drafts left in the Buy 1 window
 * (Boris 2026-08-28). Same idempotent pattern as _broadcast-zone-instant-noti.mjs.
 * Whole bell links to the promos page (Boris: "Banana Zone Promo" line = tap target).
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const TITLE = '1 JackHOF seat in the next 8 Drafts';
const MESSAGE = `Buy 1 Get 1 Spin for the next 8 Drafts
Banana Zone Promo`;
const KEY = 'zone-1seat-8drafts';

const [users, bots] = await Promise.all([
  db.collection('v2_users').select().get(),
  db.collection('botWallets').select().get(),
]);
const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
const wallets = users.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/i.test(w) && !botSet.has(w.toLowerCase()));
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${wallets.length} users`);
if (!APPLY) { console.log(TITLE + '\n' + MESSAGE); process.exit(0); }

let created = 0, skipped = 0, failed = 0;
for (const wallet of wallets) {
  try {
    await db.collection('marketplace_notifications').doc(`${wallet}__${KEY}`).create({
      wallet, type: 'promo', title: TITLE, message: MESSAGE, link: '/promos',
      dedupeKey: KEY, icon: '🍌', read: false,
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
