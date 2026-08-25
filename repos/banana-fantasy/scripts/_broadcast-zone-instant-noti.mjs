/**
 * One-time broadcast: Banana Zone INSTANT update (Boris 2026-08-25).
 * Same idempotent pattern as _broadcast-streamed-drafts-noti.mjs.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const TITLE = 'Banana Zone update';
const MESSAGE = `5 JackHOF seats are hidden in the next 16 drafts — live counter on the zone card.
• Packs now open the moment your draft fills — no more waiting for the batch.
• New windows: drafts 1–30 = Buy 1 Get 1 Spin with 3 JackHOF seats, drafts 31–60 = Buy 2 Get 1 Spin with 7 seats.
• Jackpot hits early? The draft that hits it splits every seat still hidden.
Every paid draft fill = 1 Pack, and Spins earn at your window's rate.`;

const [users, bots] = await Promise.all([
  db.collection('v2_users').select().get(),
  db.collection('botWallets').select().get(),
]);
const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
const wallets = users.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/i.test(w) && !botSet.has(w.toLowerCase()));
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${wallets.length} users`);
if (!APPLY) { console.log(MESSAGE); process.exit(0); }

let created = 0, skipped = 0, failed = 0;
for (const wallet of wallets) {
  try {
    await db.collection('marketplace_notifications').doc(`${wallet}__zone-instant-update`).create({
      wallet, type: 'promo', title: TITLE, message: MESSAGE, link: '/promos',
      dedupeKey: 'zone-instant-update', icon: '🍌', read: false,
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
