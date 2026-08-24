/**
 * Swap the bell's pinned notification (Boris 2026-08-24): unpin whatever is
 * currently pinned, pin the streamed-drafts-herzig-castro broadcast instead.
 *   node _swap-pinned-bell.mjs          # dry run: show current pinned keys
 *   node _swap-pinned-bell.mjs --apply
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const pinnedSnap = await db.collection('marketplace_notifications').where('pinned', '==', true).get();
const byKey = {};
for (const d of pinnedSnap.docs) {
  const k = d.get('dedupeKey') || '(none)';
  byKey[k] = (byKey[k] || 0) + 1;
}
console.log('currently pinned:', JSON.stringify(byKey));
if (!APPLY) { console.log('dry run — nothing changed'); process.exit(0); }

let unpinned = 0;
for (const d of pinnedSnap.docs) {
  if (d.get('dedupeKey') === 'streamed-drafts-herzig-castro') continue;
  await d.ref.update({ pinned: false }); unpinned++;
}
const target = await db.collection('marketplace_notifications').where('dedupeKey', '==', 'streamed-drafts-herzig-castro').get();
let pinned = 0;
for (const d of target.docs) { await d.ref.update({ pinned: true }); pinned++; }
console.log(`done: unpinned=${unpinned} pinned=${pinned}`);
