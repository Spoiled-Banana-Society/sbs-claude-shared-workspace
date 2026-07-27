/**
 * ⚠️ ONE-SHOT — bell blast announcing Spin-on-Purchase (every paid draft
 * includes a Free Bonus Spin), launched 2026-07-27. One 'promo' notification
 * per v2_users wallet. Copy approved by Richard 2026-07-27.
 *
 * Idempotent: doc id = `${wallet}__spin-on-purchase-launch-2026-07` written
 * with .create() — re-running never double-notifies or resurrects a read
 * notification.
 *
 * Usage:
 *   node scripts/_broadcast-spin-on-purchase-noti.mjs           # dry run
 *   node scripts/_broadcast-spin-on-purchase-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'spin-on-purchase-launch-2026-07';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: '🍌 New: Every draft purchase now includes a Free Bonus Spin on the Banana Wheel',
  message: 'Your entry is locked the moment you buy — the spin is a bonus. With your purchase you can now turn it into 20 Drafts, a Jackpot seat, and more.',
  link: '/buy-drafts',
  dedupeKey: DEDUPE_KEY,
  icon: 'spin',
  read: false,
};

const userRefs = await db.collection('v2_users').listDocuments();
const wallets = userRefs.map((r) => r.id.toLowerCase()).filter((w) => w.startsWith('0x') && w !== ZERO);
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${wallets.length} wallets (of ${userRefs.length} v2_users docs)`);
console.log(`title  : ${NOTI.title}`);
console.log(`link   : ${NOTI.link}`);
console.log(`dedupe : ${DEDUPE_KEY}`);

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
