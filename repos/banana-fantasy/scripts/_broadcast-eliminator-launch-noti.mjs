/**
 * ⚠️ ONE-SHOT — bell notification blast announcing THE ELIMINATOR.
 *
 * Writes one 'promo' notification per v2_users wallet so every user's header
 * bell lights up. Idempotent: doc id = `${wallet}__eliminator-launch-2026-07`
 * written with .create(), the same dedupe lib/queueNotifications.ts uses — so
 * re-running never double-notifies or resurrects a read notification.
 *
 * ⚠️ RUN ORDER MATTERS. Fire this only AFTER:
 *   1. 'eliminator' has been removed from ADMIN_PREVIEW_PROMO_TYPES and added
 *      to VISIBLE_PROMO_TYPES_ORDER in lib/promoFilter.ts, AND
 *   2. that deploy is live
 * Otherwise the bell lands on a /promos page where the promo is still
 * admin-only and the leaderboard is hidden — the exact dead-end the Banana
 * Draw's pre-launch hold was written to avoid.
 *
 * Usage:
 *   node scripts/_broadcast-eliminator-launch-noti.mjs           # dry run
 *   node scripts/_broadcast-eliminator-launch-noti.mjs --apply   # write
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APPLY = process.argv.includes('--apply');
const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
if (!m) { console.error('no SA'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const DEDUPE_KEY = 'eliminator-launch-2026-07';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: '🔥 THE ELIMINATOR is live',
  message: 'Every hour, the list burns down to 5 people. Enter any draft to get on it — paid +2 Bananas, free +1, and every hour you survive is another +10. Get burned and you keep every Banana. At 9pm PT the last 5 standing win: one takes a JACKHOF SEAT, the other four get 2 spins each. Five nights, five seats.',
  link: '/promos?promo=eliminator',
  dedupeKey: DEDUPE_KEY,
  icon: '🔥',
  read: false,
};

const userRefs = await db.collection('v2_users').listDocuments();
const wallets = userRefs.map((r) => r.id.toLowerCase()).filter((w) => w.startsWith('0x') && w !== ZERO);
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${wallets.length} wallets (of ${userRefs.length} v2_users docs)`);

let created = 0, skipped = 0, failed = 0;
for (const wallet of wallets) {
  const docId = `${wallet}__${DEDUPE_KEY}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  if (!APPLY) { created++; continue; }
  try {
    await db.collection('marketplace_notifications').doc(docId).create({
      wallet,
      ...NOTI,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  } catch (e) {
    if (e?.code === 6 || /already exists/i.test(String(e))) { skipped++; continue; }
    failed++;
    console.error('FAIL', wallet, String(e).slice(0, 120));
  }
}
console.log(`done: created=${created} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
