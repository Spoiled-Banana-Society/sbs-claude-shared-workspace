import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({
  credential: cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = getDatabase();

// Peek at the most-recent draft slot we know is in-progress
for (const slot of ['2024-fast-draft-806', '2024-fast-draft-807', '2024-fast-draft-805']) {
  const snap = await db.ref(`drafts/${slot}`).get();
  const v = snap.val();
  console.log(`drafts/${slot}:`, v ? JSON.stringify({ numPlayers: v.numPlayers, hasRealTimeDraftInfo: !!v.realTimeDraftInfo }) : 'NULL');
}
process.exit(0);
