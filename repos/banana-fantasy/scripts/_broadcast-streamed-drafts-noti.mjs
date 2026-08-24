/**
 * One-time broadcast bell: streamed drafts with Justin Herzig + Felix Castro
 * (Boris 2026-08-24). Same pattern as _broadcast-bz-v2-noti.mjs — idempotent
 * per-wallet .create() with a fixed dedupe key, dry run by default.
 *   node _broadcast-streamed-drafts-noti.mjs           # dry run (counts only)
 *   node _broadcast-streamed-drafts-noti.mjs --apply   # send
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
  const docId = `${wallet}__streamed-drafts-herzig-castro`;
  try {
    await db.collection('marketplace_notifications').doc(docId).create({
      wallet,
      type: 'promo',
      title: '🍌 Justin Herzig + Felix Castro are drafting on SBS',
      message: "Two streamed drafts Tuesday night. 9PM ET — Founder Draft with Justin Herzig, best ball's GOAT and SBS advisor. 9:30PM ET — Felix Castro, DK Best Ball Millionaire Season 2 champ. Tap to see the announcement.",
      link: 'https://x.com/SBSFantasy/status/2092010645457965355',
      dedupeKey: 'streamed-drafts-herzig-castro',
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
