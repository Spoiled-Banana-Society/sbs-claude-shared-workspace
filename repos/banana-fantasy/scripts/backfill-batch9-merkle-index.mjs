/**
 * One-off backfill: batch_proofs/9 is missing merkleBatchIndexInRound
 * because the Go struct uses `omitempty` and the value (0) was dropped.
 * Set it explicitly so /api/drafts/{id}/merkle-proof can dereference.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const ref = db.collection('batch_proofs').doc('9');
const snap = await ref.get();
if (!snap.exists) throw new Error('batch_proofs/9 not found');
const data = snap.data();
if (data.merkleBatchIndexInRound !== undefined) {
  console.log(`Already set: merkleBatchIndexInRound = ${data.merkleBatchIndexInRound}. No-op.`);
  process.exit(0);
}
if (data.merkleRound !== 1) {
  throw new Error(`Expected merkleRound=1, got ${data.merkleRound} — backfill won't apply`);
}

await ref.update({ merkleBatchIndexInRound: 0 });
console.log('Backfilled batch_proofs/9 with merkleBatchIndexInRound: 0');
process.exit(0);
