/**
 * ⚠️ ONE-SHOT — bell blast: packs sprint final 90 minutes (Richard 2026-08-03
 * ~6:40pm PT, event ends ~8pm PT). JackHOF/Jackpot/HOF seats lead the copy.
 * Idempotent via .create() on `${wallet}__{DEDUPE_KEY}`.
 *
 * Usage:
 *   node scripts/_broadcast-packs-sprint-noti.mjs           # dry run
 *   node scripts/_broadcast-packs-sprint-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'packs-sprint-2026-08-03';
const ZERO = '0x0000000000000000000000000000000000000000';

const NOTI = {
  type: 'promo',
  title: 'JackHOF, Jackpot & HOF Seats — 90 Minutes Left',
  message: 'Do drafts, get packs, win prizes — the more drafts you finish, the more packs you get. Tonight’s packs hold a JackHOF seat, a Jackpot seat, a HOF seat, plus 19 spin prizes. Ends around 8pm PT — draft now.',
  link: '/draft',
  dedupeKey: DEDUPE_KEY,
  icon: 'crown',
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
