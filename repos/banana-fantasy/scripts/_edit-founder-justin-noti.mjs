/**
 * EDIT the already-sent 2026-08-17 Founder Draft (Justin Herzig) bell in place — add "livestreamed on X" (Boris).
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

const DEDUPE_KEY = 'founder-justin-2026-08-17';
const TITLE = '👑 Founder Draft in 2 hours — with the legend Justin Herzig';
const MESSAGE = 'Today at 2 PM ET, livestreamed on X. Enter with a paid draft and get a Free Spin. Tap for the post on X.';

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
