/**
 * ⚠️ ONE-SHOT — bell notification blast announcing the rolling-windows
 * system + JackHOF (cutover at draft 201, 2026-07-20). Copy mirrors the
 * @SBSFantasy announcement tweet. Writes one 'promo' notification per
 * v2_users wallet so every user's header bell lights up.
 *
 * Idempotent: doc id = `${wallet}__jackhof-rolling-launch-2026-07` written
 * with .create(), same dedupe as lib/queueNotifications.ts — re-running
 * never double-notifies or resurrects a read notification.
 *
 * Run AFTER the JackHOF copy deploy is live, so tapping the notification
 * lands on a /jackpot-hof page that actually explains JackHOF.
 *
 * Usage:
 *   node scripts/_broadcast-jackhof-launch-noti.mjs           # dry run
 *   node scripts/_broadcast-jackhof-launch-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'jackhof-rolling-launch-2026-07';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: '🔴🟡 Introducing JackHOF',
  message: 'A Jackpot is now ALWAYS within the next 100 drafts — the hunt resets the moment it hits, no dead zones. 5 HOF per window, same deal. And when both land on the SAME draft: JackHOF. Finals skip + HOF prizes, two perks on one draft. Roughly 1 in 800. It has never hit.',
  link: '/jackpot-hof',
  dedupeKey: DEDUPE_KEY,
  icon: '👑',
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
