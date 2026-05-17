/**
 * Inspect batch_proofs/9 + recent drafts collection to debug the feed.
 * Usage: node scripts/inspect-batch9.mjs
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

console.log('=== batch_proofs/9 ===');
const batch9 = await db.collection('batch_proofs').doc('9').get();
if (!batch9.exists) {
  console.log('batch_proofs/9 does NOT exist');
} else {
  const d = batch9.data();
  console.log({
    batchNumber: d.batchNumber,
    status: d.status,
    variant: d.variant,
    merkleRound: d.merkleRound,
    merkleRoundNumber: d.merkleRoundNumber,
    merkleBatchIndexInRound: d.merkleBatchIndexInRound,
    jackpotPositions: d.jackpotPositions,
    hofPositions: d.hofPositions,
    keys: Object.keys(d),
  });
}

console.log('\n=== drafts/draftTracker ===');
const tracker = await db.collection('drafts').doc('draftTracker').get();
const t = tracker.data();
console.log({
  FilledLeaguesCount: t?.FilledLeaguesCount,
  JackpotLeagueIds: t?.JackpotLeagueIds,
  HofLeagueIds: t?.HofLeagueIds,
});

console.log('\n=== 5 most recent drafts (by __name__ desc) ===');
const recent = await db.collection('drafts').orderBy('__name__', 'desc').limit(8).get();
for (const doc of recent.docs) {
  const data = doc.data();
  console.log(`  ${doc.id}: Level=${data.Level} DisplayName=${data.DisplayName}`);
}

console.log('\n=== docs matching 2025-fast-draft-801 ===');
for (const speed of ['fast', 'slow']) {
  for (const year of ['2024', '2025']) {
    const id = `${year}-${speed}-draft-801`;
    const snap = await db.collection('drafts').doc(id).get();
    if (snap.exists) {
      console.log(`  FOUND ${id}: ${JSON.stringify({ Level: snap.data().Level, DisplayName: snap.data().DisplayName })}`);
    }
  }
}

process.exit(0);
