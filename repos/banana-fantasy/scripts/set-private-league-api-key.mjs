// Generate (or rotate) the partner API key for ONE private league.
//   node scripts/set-private-league-api-key.mjs <leagueId>
// Prints the plaintext key ONCE — only its sha256 is stored (ApiKeyHash on
// private_leagues/{id}). Hand the key to the commissioner for their SERVER
// (never browser code). Re-running rotates: the old key stops working.
import admin from 'firebase-admin';
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../lib/firebaseAdmin.ts', import.meta.url), 'utf8');
const b64 = src.match(/STAGING_SA_B64 = '([^']+)'/)[1];
const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const id = (process.argv[2] || '').toLowerCase();
if (!/^[a-z0-9-]{2,30}$/.test(id)) {
  console.error('usage: node scripts/set-private-league-api-key.mjs <leagueId>');
  process.exit(1);
}
const ref = db.collection('private_leagues').doc(id);
const snap = await ref.get();
if (!snap.exists) { console.error(`private league "${id}" does not exist`); process.exit(1); }
const key = `sbs_pl_${id}_${randomBytes(24).toString('base64url')}`;
await ref.set({ ApiKeyHash: createHash('sha256').update(key).digest('hex') }, { merge: true });
console.log(`API key for ${id} (shown once, store it now):\n${key}`);
