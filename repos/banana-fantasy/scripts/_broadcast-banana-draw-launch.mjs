/**
 * ⚠️ ONE-SHOT — bell blast announcing the Banana Draw ("Collect Bananas →
 * JACKHOF SEAT"), launched 2026-07-26. One 'promo' notification per v2_users
 * wallet so every header bell lights up.
 *
 * Idempotent: doc id = `${wallet}__banana-draw-launch-2026-07` written with
 * .create(), the same dedupe lib/queueNotifications.ts uses — re-running never
 * double-notifies or resurrects a read notification.
 *
 * Run only AFTER the promo is public (banana-draw in VISIBLE_PROMO_TYPES_ORDER
 * and deployed), so tapping the bell lands on a promo that actually exists.
 * The Pick 6/9/10 bells were the counter-example: 1,382 notifications pointing
 * at a promo that had been retired, which had to be deleted by hand.
 *
 * Usage:
 *   node scripts/_broadcast-banana-draw-launch.mjs           # dry run
 *   node scripts/_broadcast-banana-draw-launch.mjs --apply   # write
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

const DEDUPE_KEY = 'banana-draw-launch-2026-07';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: 'Be part of the first ever JackHOF draft',
  message: 'Every draft you fill now earns Bananas — free drafts 1, paid drafts 2. Invite a friend and you get 5 more when they draft, plus 5 when they buy passes. Every 24 hours one Banana is drawn and that player takes a seat in the first JackHOF draft ever run: Jackpot + Hall of Fame on one roster. 10 seats, then it drafts. More Bananas, better odds — but all it takes is one.',
  link: '/promos?promo=banana-draw',
  dedupeKey: DEDUPE_KEY,
  icon: 'ticket',
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
