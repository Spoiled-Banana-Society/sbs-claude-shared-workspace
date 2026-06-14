// One-off cleanup: remove the test "League 92" footprint from marketplace_index
// so it can't ghost into the real League 92 later. Targets ONLY entries tagged
// leagueNumber==92 (all test data — no real league 92 exists yet). Tokens:
// 32, 35, 38, 42, 54, 62, 70, 81, 83. Staging has no PITR — scope verified first.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const q = await db.collection('marketplace_index').where('leagueNumber', '==', 92).get();
console.log('Deleting', q.size, 'marketplace_index entries tagged leagueNumber==92:');
for (const d of q.docs) {
  console.log('  - token', d.id);
  await db.collection('marketplace_index').doc(d.id).delete();
}
const after = await db.collection('marketplace_index').where('leagueNumber', '==', 92).get();
console.log('Remaining leagueNumber==92 entries:', after.size, after.size === 0 ? '✓ clean' : '');
process.exit(0);
