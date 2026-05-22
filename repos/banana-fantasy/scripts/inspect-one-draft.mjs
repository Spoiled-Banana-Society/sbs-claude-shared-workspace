import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const draftId = process.argv[2] || '2024-fast-draft-811';
const snap = await admin.database().ref(`drafts/${draftId}`).once('value');
console.log(`=== /drafts/${draftId} ===`);
const data = snap.val();
if (!data) { console.log('  (no data)'); process.exit(0); }
console.log('Top-level keys:', Object.keys(data));
console.log('displayName:', JSON.stringify(data.displayName));
console.log('numPlayers:', data.numPlayers);
if (data.realTimeDraftInfo) {
  console.log('realTimeDraftInfo keys:', Object.keys(data.realTimeDraftInfo));
  console.log('  pickEndTime:', data.realTimeDraftInfo.pickEndTime, '(', new Date(data.realTimeDraftInfo.pickEndTime).toISOString(), ')');
}
// Also check the Firestore draft doc for comparison
const fs = admin.firestore();
const doc = await fs.collection('drafts').doc(draftId).get();
if (doc.exists) {
  const d = doc.data();
  console.log('\n=== Firestore drafts/', draftId, ' ===');
  console.log('DisplayName:', d.DisplayName, '|displayName:', d.displayName, '|Level:', d.Level);
  console.log('FilledLeaguesCount:', d.FilledLeaguesCount, '|LeagueId:', d.LeagueId);
}
process.exit(0);
