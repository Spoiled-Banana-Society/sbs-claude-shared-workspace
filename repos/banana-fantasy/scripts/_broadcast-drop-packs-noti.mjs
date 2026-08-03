/**
 * Personalised bell: "you already have N packs waiting for tonight."
 *
 * Sent to everyone who filled a draft today and was picked up by the backfill,
 * so the promo doesn't launch to people who have to start from zero — they open
 * the bell and find a stack already waiting (Richard 2026-08-02).
 *
 * Reads the REAL pack docs for tonight rather than recomputing from activity,
 * so the number in the bell is exactly what the page will show.
 *
 * Idempotent: doc id = `${wallet}__drop-packs-<nightId>` written with .create(),
 * so re-running never double-notifies.
 *
 * ⚠️ Run AFTER the backfill, and after the promo is live — the bell links to
 * /drop and there's no point sending someone to a page that's still gated.
 *
 * Usage:
 *   node scripts/_broadcast-drop-packs-noti.mjs           # dry run
 *   node scripts/_broadcast-drop-packs-noti.mjs --apply   # write
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

// Same rule as lib/dropRates.nightIdFor: after 8pm PT a pack belongs to tomorrow.
const laHour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }).format(new Date()));
const laDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [y, mo, d] = laDate.split('-').map(Number);
const roll = new Date(Date.UTC(y, mo - 1, d));
if (laHour >= 20) roll.setUTCDate(roll.getUTCDate() + 1);
const nightId = `${roll.getUTCFullYear()}-${String(roll.getUTCMonth() + 1).padStart(2, '0')}-${String(roll.getUTCDate()).padStart(2, '0')}`;

const packs = await db.collection('drop_nights').doc(nightId).collection('packs').get();
const byUser = new Map();
for (const doc of packs.docs) {
  const p = doc.data();
  byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + 1);
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — night ${nightId}`);
console.log(`  ${packs.size} packs across ${byUser.size} players\n`);
const rows = [...byUser.entries()].sort((a, b) => b[1] - a[1]);
for (const [w, n] of rows.slice(0, 15)) console.log(`   ${w.slice(0, 12)}…  ${n} packs`);
if (rows.length > 15) console.log(`   … and ${rows.length - 15} more`);

if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0); }

let created = 0, skipped = 0, failed = 0;
for (const [wallet, n] of rows) {
  const docId = `${wallet}__drop-packs-${nightId}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  try {
    await db.collection('marketplace_notifications').doc(docId).create({
      wallet,
      type: 'promo',
      title: `🌙 You have ${n} pack${n === 1 ? '' : 's'} waiting`,
      message: `Your drafts today earned ${n} sealed pack${n === 1 ? '' : 's'} for tonight's Drop. They open at 8:00 PM PT — 1 JackHOF seat, 1 HOF seat and 15 free spins go out every night. Tap to see your stack.`,
      link: '/drop',
      dedupeKey: `drop-packs-${nightId}`,
      icon: '🌙',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    created++;
  } catch (e) {
    if (e?.code === 6 || /already exists/i.test(String(e))) { skipped++; continue; }
    failed++;
    console.error('FAIL', wallet, String(e).slice(0, 120));
  }
}
console.log(`\ndone: created=${created} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
