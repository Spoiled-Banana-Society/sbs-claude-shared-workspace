import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const fs = admin.firestore();
const rtdb = admin.database();

const DRAFT_ID_RE = /^(2024-(fast|slow)-draft-\d+|queue-\d+|special-.*)$/;

// 1. Firestore: delete draft docs (skip draftTracker + any settings docs)
const snap = await fs.collection('drafts').get();
let fsDeleted = 0, fsSkipped = [];
for (const doc of snap.docs) {
  if (DRAFT_ID_RE.test(doc.id)) {
    await doc.ref.delete();
    fsDeleted++;
  } else {
    fsSkipped.push(doc.id);
  }
}
console.log(`Firestore: deleted ${fsDeleted} draft docs`);
console.log(`Firestore: kept (not drafts): ${fsSkipped.join(', ') || '(none)'}`);

// 2. RTDB: the drafts/ node only holds per-draft live state — safe to wipe whole node
const rtdbSnap = await rtdb.ref('drafts').once('value');
const rtdbCount = rtdbSnap.exists() ? Object.keys(rtdbSnap.val() || {}).length : 0;
await rtdb.ref('drafts').remove();
console.log(`RTDB: removed drafts/ node (${rtdbCount} entries)`);

// 3. Verify
const verifyFs = await fs.collection('drafts').get();
const remainingDrafts = verifyFs.docs.filter(d => DRAFT_ID_RE.test(d.id)).length;
const verifyRtdb = await rtdb.ref('drafts').once('value');
console.log(`\nVerify — Firestore draft docs remaining: ${remainingDrafts}`);
console.log(`Verify — RTDB drafts node: ${verifyRtdb.exists() ? 'still exists' : 'empty (good)'}`);
process.exit(0);
