/**
 * One-time broadcast bell: Banana Zone v2 launch (Boris 2026-08-24).
 * Same pattern as _broadcast-drop-packs-noti.mjs — idempotent per-wallet
 * .create() with a fixed dedupe key, dry run by default.
 *   node bz-v2-bell.mjs           # dry run (counts only)
 *   node bz-v2-bell.mjs --apply   # send
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
if (!m) { console.error('no SA'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const [users, bots] = await Promise.all([
  db.collection('v2_users').select().get(),
  db.collection('botWallets').select().get(),
]);
const botSet = new Set(bots.docs.map((d) => d.id.toLowerCase()));
const wallets = users.docs.map((d) => d.id).filter((w) => /^0x[0-9a-f]{40}$/i.test(w) && !botSet.has(w.toLowerCase()));
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${wallets.length} users`);
if (!APPLY) { console.log('Dry run — nothing written. Re-run with --apply.'); process.exit(0); }

let created = 0, skipped = 0, failed = 0;
for (const wallet of wallets) {
  const docId = `${wallet}__bz-v2-launch`;
  try {
    await db.collection('marketplace_notifications').doc(docId).create({
      wallet,
      type: 'promo',
      title: '🍌 The Banana Zone just leveled up',
      message: 'Free Spins + JackHOF Seats — Buy 1 Get 1 Spin is LIVE. Every paid draft fill earns a Spin and a sealed Pack, with 10 JackHOF seats hidden inside. Tap to see it. Full breakdown on X: x.com/SBSFantasy/status/2091940031716032821',
      link: '/promos?promo=bonus-zone',
      dedupeKey: 'bz-v2-launch',
      icon: '🍌',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  } catch (e) {
    if (e?.code === 6 || /already exists/i.test(String(e))) { skipped++; continue; }
    failed++;
    console.error('FAIL', wallet, String(e).slice(0, 100));
  }
}
console.log(`done: created=${created} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
