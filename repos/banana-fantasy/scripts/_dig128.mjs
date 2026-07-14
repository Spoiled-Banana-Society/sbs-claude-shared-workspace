// Deep-dig 2026-fast-draft-128: members, picks so far, pass types
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();
const ID = '2026-fast-draft-128';

const doc = await db.collection('drafts').doc(ID).get();
console.log('=== drafts doc exists:', doc.exists);
if (doc.exists) console.log(JSON.stringify(doc.data(), null, 1).slice(0, 3000));

// state subcollection
const stateDocs = await db.collection('drafts').doc(ID).collection('state').get();
for (const s of stateDocs.docs) {
  console.log(`\n--- state/${s.id}:`, JSON.stringify(s.data()).slice(0, 1500));
}

// Go league doc? find leagues collection
for (const coll of ['leagues', 'v2_leagues', 'draftLeagues']) {
  const l = await db.collection(coll).doc(ID).get().catch(() => null);
  if (l && l.exists) console.log(`\n=== ${coll}/${ID}:`, JSON.stringify(l.data(), null, 1).slice(0, 2500));
}
process.exit(0);
