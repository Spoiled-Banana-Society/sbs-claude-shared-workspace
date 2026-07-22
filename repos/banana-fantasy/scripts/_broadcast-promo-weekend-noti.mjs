/**
 * ⚠️ ONE-SHOT — bell blast announcing the WEEKEND PROMO window
 * (Boris 2026-07-21): until Sunday 12pm PT, FREE drafts count toward every
 * promo, and Picks 9 & 10 both win a Free Spin.
 *
 * Idempotent: doc id = `${wallet}__promo-weekend-free-drafts-2026-07` via
 * .create() — same dedupe pattern as lib/queueNotifications.ts. Re-running
 * never double-notifies.
 *
 * Run AFTER the weekend-window deploy is live (behavior must match the bell).
 *
 * Usage:
 *   node scripts/_broadcast-promo-weekend-noti.mjs           # dry run
 *   node scripts/_broadcast-promo-weekend-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'promo-weekend-free-drafts-2026-07';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: 'Weekend Promo — FREE Drafts Count!',
  message: 'Until Sunday 12pm PT: FREE drafts count toward EVERY promo — and Picks 9 & 10 both win a Free Spin. Every draft you enter is working for you. Draft now!',
  link: '/promos',
  dedupeKey: DEDUPE_KEY,
  icon: 'spin',
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
