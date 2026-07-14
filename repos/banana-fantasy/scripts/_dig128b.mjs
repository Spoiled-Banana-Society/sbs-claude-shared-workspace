import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = admin.firestore();
const rtdb = admin.database();
const ID = '2026-fast-draft-128';

const sum = await db.doc(`drafts/${ID}/state/summary`).get();
const S = sum.data().Summary || [];
console.log('summary entries:', S.length);
S.forEach((e, i) => {
  const p = e.PlayerInfo || {};
  console.log(`  [${i}] pick=${p.PickNum} r${p.Round} ${p.PlayerId || '(EMPTY)'} owner=${(p.OwnerAddress || '').slice(0, 10)}`);
});

const rt = await rtdb.ref(`drafts/${ID}/realTimeDraftInfo`).once('value');
console.log('\nRTDB rtd:', JSON.stringify(rt.val(), null, 1));

// autodraft prefs / draft state doc?
const stateInfo = await db.doc(`drafts/${ID}/state/info`).get();
const d = stateInfo.data();
console.log('\nstate/info CurrentPickNumber:', d.CurrentPickNumber, 'CurrentDrafter:', d.CurrentDrafter);

// look for preferences docs
const prefs = await db.collection('drafts').doc(ID).collection('preferences').get().catch(() => null);
if (prefs) for (const p of prefs.docs) console.log('pref', p.id, JSON.stringify(p.data()).slice(0, 300));
// ownerPreferences? autoDraft flags often in state or per-owner docs — list all subcollections
const subs = await db.collection('drafts').doc(ID).listCollections();
console.log('\nsubcollections:', subs.map(s => s.id).join(', '));
for (const s of subs) {
  if (s.id === 'state') continue;
  const docs = await s.limit(20).get();
  for (const doc of docs.docs) console.log(`  ${s.id}/${doc.id}:`, JSON.stringify(doc.data()).slice(0, 400));
}
process.exit(0);
