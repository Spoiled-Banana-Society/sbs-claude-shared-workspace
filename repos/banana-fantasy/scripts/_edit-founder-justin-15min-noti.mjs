/**
 * EDIT the 15-min founder bell in place — add Justin Herzig to the message (Boris).
 *
 * The title read "THE DROP is live", which says nothing about what you get.
 * It has to lead with the JackHOF draft (Richard 2026-08-02).
 *
 * Updates the existing docs rather than writing new ones — 868 people already
 * have this notification and re-blasting would double-notify everyone.
 *
 * Usage:
 *   node scripts/_edit-drop-launch-noti.mjs           # dry run
 *   node scripts/_edit-drop-launch-noti.mjs --apply   # write
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

const DEDUPE_KEY = 'founder-justin-15min-2026-08-17';
const TITLE = '👑 15 minutes — Founder Draft with Justin Herzig, live on X';
const MESSAGE = 'Founder Drafts are usually Wednesdays — today is a bonus one with special guest Justin Herzig. At 2 PM ET the founders hit Enter Draft; land in that same draft and you are in. Paid entry = Free Spin. Free passes can join too. Tap to see how it works.';

const snap = await db.collection('marketplace_notifications')
  .where('dedupeKey', '==', DEDUPE_KEY).get();

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${snap.size} existing notifications`);
console.log(`\nnew title:   ${TITLE}`);
console.log(`new message: ${MESSAGE}\n`);
if (!APPLY) { console.log('Dry run — nothing written. Re-run with --apply.'); process.exit(0); }

let n = 0;
const CHUNK = 400;
for (let i = 0; i < snap.docs.length; i += CHUNK) {
  const batch = db.batch();
  for (const d of snap.docs.slice(i, i + CHUNK)) {
    batch.set(d.ref, { title: TITLE, message: MESSAGE }, { merge: true });
    n++;
  }
  await batch.commit();
}
console.log(`done: updated=${n}`);
