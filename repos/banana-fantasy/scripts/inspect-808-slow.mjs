import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const tracker = (await db.collection('drafts').doc('draftTracker').get()).data();
console.log('FilledLeaguesCount:', tracker.FilledLeaguesCount);

console.log('\nAll docs with DisplayName containing 806/807/808:');
const snap = await db.collection('drafts')
  .where('DisplayName', 'in', ['BBB #806', 'BBB #807', 'BBB #808'])
  .get();
snap.forEach(d => {
  const data = d.data();
  console.log(`  id=${d.id}  DisplayName=${data.DisplayName}  Level=${data.Level}  Status=${data.Status || '?'}`);
});
process.exit(0);
