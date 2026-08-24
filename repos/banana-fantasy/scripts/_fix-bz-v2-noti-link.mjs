// One-time: point the bz-v2-launch bells at plain /promos (the modal
// deep-link was opening DETAILS over the new card — Boris 2026-08-24).
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();
const snap = await db.collection('marketplace_notifications').where('dedupeKey', '==', 'bz-v2-launch').get();
console.log('bells to fix:', snap.size);
let done = 0;
const docs = snap.docs;
for (let i = 0; i < docs.length; i += 400) {
  const batch = db.batch();
  for (const d of docs.slice(i, i + 400)) batch.update(d.ref, { link: '/promos' });
  await batch.commit();
  done += Math.min(400, docs.length - i);
}
console.log('updated:', done);
