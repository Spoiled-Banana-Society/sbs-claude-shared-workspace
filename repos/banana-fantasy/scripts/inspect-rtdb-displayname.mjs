import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const snap = await admin.database().ref('drafts').once('value');
const all = snap.val() || {};
const recent = [];
for (const [id, data] of Object.entries(all)) {
  if (data && typeof data === 'object' && (data.numPlayers || data.displayName)) {
    recent.push({ draftId: id, numPlayers: data.numPlayers, displayName: data.displayName || '(MISSING)', pickEnd: data.realTimeDraftInfo?.pickEndTime });
  }
}
recent.sort((a, b) => (b.pickEnd || 0) - (a.pickEnd || 0));
console.log(`Total drafts in RTDB: ${Object.keys(all).length}`);
console.log('Most recent 10 drafts:');
for (const r of recent.slice(0, 10)) console.log(`  ${r.draftId} | numPlayers=${r.numPlayers} | displayName=${r.displayName}`);
process.exit(0);
