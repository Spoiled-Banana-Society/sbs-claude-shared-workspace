/**
 * One-off: flips system_config/batchProof.contractVariant to whatever
 * is passed as argv[2]. Reads FIREBASE_SERVICE_ACCOUNT_JSON from
 * .env.production directly (brace-matched extraction — the JSON spans
 * multiple lines).
 *
 *   node scripts/flip-batch-proof-variant.mjs vrf-commit-merkle
 *
 * Go API needs to be redeployed after the flip for the change to take
 * effect at the next batch boundary.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const variant = process.argv[2];
if (!variant) {
  console.error('Usage: node scripts/flip-batch-proof-variant.mjs <variant>');
  process.exit(1);
}
const ALLOWED = ['commit-reveal', 'vrf', 'vrf-commit', 'vrf-commit-merkle'];
if (!ALLOWED.includes(variant)) {
  console.error(`variant must be one of: ${ALLOWED.join(', ')}`);
  process.exit(1);
}

// The SA in .env.production is base64-encoded JSON on a single line.
const envText = readFileSync('.env.production', 'utf8');
const match = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
if (!match) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not found (or not base64) in .env.production');
const saJson = Buffer.from(match[1], 'base64').toString('utf8');
const sa = JSON.parse(saJson);

initializeApp({ credential: cert(sa) });
const db = getFirestore();

const ref = db.collection('system_config').doc('batchProof');
const snap = await ref.get();
if (!snap.exists) {
  console.error('system_config/batchProof not found — deploy the batch proof contract first');
  process.exit(1);
}
const before = snap.data() ?? {};
const previousVariant = before.contractVariant ?? '(unset)';

if (previousVariant === variant) {
  console.log(`Already at variant=${variant}, nothing to do.`);
  process.exit(0);
}

await ref.set({ contractVariant: variant }, { merge: true });
console.log(`✓ Flipped contractVariant: ${previousVariant} → ${variant}`);
console.log('Remember: the Go API needs to be redeployed for this to take effect at the next batch boundary.');
process.exit(0);
