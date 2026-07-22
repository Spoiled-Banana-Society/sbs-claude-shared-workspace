/**
 * ⚠️ ONE-SHOT — bell blast: deposits are live + the card-fee credit perk
 * (Boris 2026-07-22). Idempotent via .create() on `${wallet}__{DEDUPE_KEY}`.
 * Copy can be hot-edited in place afterward (update the docs by dedupeKey) —
 * unread bells re-render on next fetch.
 *
 * Usage:
 *   node scripts/_broadcast-deposits-live-noti.mjs           # dry run
 *   node scripts/_broadcast-deposits-live-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'deposits-live-credit-2026-07';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: 'NEW — Deposits Are Live',
  message: 'Add money once, enter every draft in one tap — Apple Pay, Venmo, PayPal, debit, or MetaMask. Your first card deposit includes a FREE Paid Draft Pass — and every $25 we credit back becomes another one, automatically.',
  link: '/draft',
  dedupeKey: DEDUPE_KEY,
  icon: 'banknote',
  read: false,
};

const userRefs = await db.collection('v2_users').listDocuments();
const wallets = userRefs.map((r) => r.id.toLowerCase()).filter((w) => w.startsWith('0x') && w !== ZERO);
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${wallets.length} wallets`);

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
