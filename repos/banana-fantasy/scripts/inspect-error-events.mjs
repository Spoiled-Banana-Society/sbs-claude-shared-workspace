/**
 * Inspect v2_error_events — what should be lighting up the Server Errors tab.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

console.log('=== v2_error_events newest doc (full) ===');
const snap = await db.collection('v2_error_events').orderBy('timestamp', 'desc').limit(1).get();
for (const doc of snap.docs) {
  console.log(JSON.stringify(doc.data(), null, 2));
}

process.exit(0);
