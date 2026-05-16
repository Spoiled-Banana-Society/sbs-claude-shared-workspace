/**
 * Quick read of merkle_rounds/{N} to verify cutover state.
 * Usage: node scripts/check-merkle-round.mjs [roundNumber]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const round = parseInt(process.argv[2] || '1', 10);

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
if (!saMatch) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not found');
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

const snap = await db.collection('merkle_rounds').doc(String(round)).get();
if (!snap.exists) {
  console.log(`merkle_rounds/${round} does not exist.`);
  process.exit(0);
}
const data = snap.data();
console.log(`merkle_rounds/${round}:`);
console.log({
  roundNumber: data.roundNumber,
  status: data.status,
  firstBatchNumber: data.firstBatchNumber,
  saltHash: data.saltHash,
  serverSalt: data.serverSalt ? data.serverSalt.slice(0, 20) + '…(sealed)' : '(missing)',
  vrfRandomness: data.vrfRandomness,
  merkleRoot: data.merkleRoot,
  merkleRootTxHash: data.merkleRootTxHash,
  commitTxHashVrf: data.commitTxHashVrf,
  openedAt: data.openedAt,
  fulfilledAt: data.fulfilledAt,
  merkleRootCommittedAt: data.merkleRootCommittedAt,
  merkleLeavesCount: data.merkleLeaves?.length ?? 0,
  jackpotByWindowCount: data.jackpotByWindow?.length ?? 0,
  hofByWindowFlatCount: data.hofByWindowFlat?.length ?? 0,
  hofByWindowSize: data.hofByWindowSize,
});

if (data.jackpotByWindow?.length === 100 && data.hofByWindowFlat?.length === 500) {
  console.log('\n✓ Structure looks correct (100 JP slots + 500 HOF flat slots)');
}
if (data.merkleLeaves?.length === 10000) {
  console.log('✓ 10,000 Merkle leaves stored');
}

const state = await db.collection('system_config').doc('merkleRoundState').get();
if (state.exists) {
  console.log('\nsystem_config/merkleRoundState:', state.data());
}

process.exit(0);
