/**
 * ⚠️ LAUNCH-DAY ONLY — bell notification blast for the July 4th
 * "Buy 2 → FREE SPIN" promo. Writes one 'promo' notification per
 * v2_users wallet so every user's header bell lights up.
 *
 * Idempotent: doc id = `${wallet}__promo-july4-2026-launch` written with
 * .create(), same as lib/queueNotifications.ts dedupe — re-running never
 * double-notifies or resurrects a read notification.
 *
 * Run AFTER the promo is publicly visible (post-deploy), so tapping the
 * notification lands on a /promos page that actually shows the card.
 *
 * Usage:
 *   node scripts/_broadcast-july4-promo-noti.mjs           # dry run
 *   node scripts/_broadcast-july4-promo-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'promo-july4-2026-launch';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: '🇺🇸 July 4th Promo is LIVE',
  message: 'Buy 2 draft passes, get a FREE Banana Wheel spin — this weekend only!',
  link: '/promos',
  dedupeKey: DEDUPE_KEY,
  icon: '🇺🇸',
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
    console.error(`FAILED ${wallet}: ${e?.message || e}`);
  }
}
console.log(`${APPLY ? 'wrote' : 'would write'} ${created}, already-existed ${skipped}, failed ${failed}`);
if (!APPLY) console.log('Dry run only. Re-run with --apply to write.');
