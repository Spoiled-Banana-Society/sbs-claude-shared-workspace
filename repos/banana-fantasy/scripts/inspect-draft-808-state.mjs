import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({
  credential: cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});

const rtdb = getDatabase();
const fs = getFirestore();

const draftId = '2024-fast-draft-808';

console.log('=== RTDB drafts/2024-fast-draft-808 ===');
const r = await rtdb.ref(`drafts/${draftId}`).get();
console.log(JSON.stringify(r.val(), null, 2));

console.log('\n=== Firestore drafts/2024-fast-draft-808 ===');
const fsDoc = await fs.collection('drafts').doc(draftId).get();
const data = fsDoc.data();
console.log(JSON.stringify({
  CurrentPickNumber: data?.CurrentPickNumber,
  CurrentRound: data?.CurrentRound,
  CurrentDrafter: data?.CurrentDrafter,
  DraftStartTime: data?.DraftStartTime,
  DisplayName: data?.DisplayName,
  Level: data?.Level,
}, null, 2));

console.log('\n=== Firestore drafts/2024-fast-draft-808/state/info ===');
const stateInfo = await fs.collection('drafts').doc(draftId).collection('state').doc('info').get();
const si = stateInfo.data();
console.log(JSON.stringify({
  pickNumber: si?.pickNumber,
  roundNum: si?.roundNum,
  pickInRound: si?.pickInRound,
  currentDrafter: si?.currentDrafter,
}, null, 2));

process.exit(0);
