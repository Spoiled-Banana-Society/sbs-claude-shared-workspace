import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const fs = admin.firestore();
const rtdb = admin.database();

const id = '2024-fast-draft-819';
const wallet = '0x19b3cc05226775552b7dd4969743678affb0efdf';

// 1. Firestore draft doc
const doc = await fs.collection('drafts').doc(id).get();
console.log(`Firestore drafts/${id}: exists=${doc.exists}`);
if (doc.exists) console.log('  keys:', Object.keys(doc.data()||{}).join(', '), ' NumPlayers=', doc.data().NumPlayers, ' DisplayName=', doc.data().DisplayName);

// 2. RTDB draft node
const r = await rtdb.ref('drafts/' + id).once('value');
console.log(`RTDB drafts/${id}: exists=${r.exists()}`);
if (r.exists()) {
  const v = r.val() || {};
  console.log('  keys:', Object.keys(v).join(', '));
  if (v.realTimeDraftInfo) console.log('  realTimeDraftInfo:', JSON.stringify(v.realTimeDraftInfo));
  console.log('  numPlayers:', JSON.stringify(v.numPlayers));
}

// 3. Any other RTDB nodes referencing 819 (queues, autodraft, etc.)
for (const path of ['draftQueue', 'autoDraft', 'activeDrafts', 'draftTimers', 'pendingPicks']) {
  const s = await rtdb.ref(path).once('value');
  if (s.exists()) {
    const v = s.val() || {};
    const hit = Object.keys(v).some(k => k.includes('819') || JSON.stringify(v[k]||'').includes(id));
    console.log(`RTDB /${path}: exists, ${Object.keys(v).length} keys, references 819: ${hit}`);
  } else {
    console.log(`RTDB /${path}: (none)`);
  }
}

// 4. wallet's tokens for 819
for (const sub of ['usedDraftTokens','validDraftTokens']) {
  const snap = await fs.collection('owners').doc(wallet).collection(sub).get();
  const m = snap.docs.filter(d => String(d.data()?.LeagueId) === id);
  console.log(`owners/${wallet}/${sub}: ${snap.size} docs, stamped-to-819: ${m.length}`);
  m.forEach(d => console.log('   card=', d.id, 'roster=', JSON.stringify(d.data()?.Roster)));
}

// 5. draftTracker + any active-draft index docs
const tr = await fs.collection('drafts').doc('draftTracker').get();
console.log('draftTracker:', JSON.stringify(tr.data()));
process.exit(0);
