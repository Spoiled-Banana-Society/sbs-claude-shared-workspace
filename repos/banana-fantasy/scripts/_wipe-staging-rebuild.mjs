#!/usr/bin/env node
// Full staging rebuild wipe — clears ALL old-contract draft/pass/team data and
// resets every counter to 0, so the new contract starts clean. Deletes DATA
// only; touches NO code, config, or system wiring.
//
// DRY-RUN by default (prints what it WOULD delete, changes nothing).
// Add  --go  to actually execute.
//
//   preview:  ~/banana-fantasy/scripts/_wipe-staging-rebuild.mjs
//   execute:  ~/banana-fantasy/scripts/_wipe-staging-rebuild.mjs --go
//
// PROTECTED (never touched): system_config/* (VRF), wheel config, merkle_rounds
// (VRF — re-randomized separately in Step 2), web2_social_identities (prod-pulled),
// and all v2_users account state EXCEPT the draftPasses counter (reset to 0).
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';

const GO = process.argv.includes('--go');
const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
if (!saMatch) { console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.production'); process.exit(1); }
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = getFirestore();
const rtdb = getDatabase();

const tag = GO ? '🔴 EXECUTE' : '🟡 DRY-RUN (nothing deleted)';
console.log(`\n================ STAGING REBUILD WIPE — ${tag} ================\n`);

// Batched delete of an entire top-level collection.
async function wipeCollection(name, { skipDocId } = {}) {
  const snap = await db.collection(name).get();
  let n = 0, batch = db.batch(), inBatch = 0;
  for (const doc of snap.docs) {
    if (skipDocId && doc.id === skipDocId) continue;
    n++;
    if (GO) {
      batch.delete(doc.ref);
      if (++inBatch >= 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
  }
  if (GO && inBatch > 0) await batch.commit();
  console.log(`  ${name}: ${GO ? 'deleted' : 'would delete'} ${n} docs${skipDocId ? ` (kept ${skipDocId})` : ''}`);
  return n;
}

// RECURSIVE wipe of a collection that has SUBCOLLECTIONS (e.g. drafts, whose
// docs hold cards/state/scores/smsNotificationClaims). A plain `.delete(docRef)`
// does NOT cascade in Firestore — it orphans every subcollection, leaving
// thousands of ghost subtrees behind (the 2026-06-13 incident: 2,507 orphans
// after a "wipe"). listDocuments() returns ALL refs INCLUDING missing parents
// that still have subcollections, and recursiveDelete() removes the doc + every
// nested subcollection. Use this for any collection with subcollections.
async function wipeCollectionRecursive(name, { skipDocId } = {}) {
  const refs = await db.collection(name).listDocuments();
  let n = 0;
  for (const ref of refs) {
    if (skipDocId && ref.id === skipDocId) continue;
    n++;
    if (GO) await db.recursiveDelete(ref);
  }
  console.log(`  ${name} (recursive, incl. subcollections): ${GO ? 'deleted' : 'would delete'} ${n} docs${skipDocId ? ` (kept ${skipDocId})` : ''}`);
  return n;
}

// Wipe an ENTIRE subcollection name across ALL parents in one streaming pass
// (collectionGroup), instead of iterating 17k owners one at a time. Counts in
// dry-run; batch-deletes in --go. Paginated so memory stays flat.
async function wipeCollectionGroup(name) {
  let total = 0;
  if (!GO) {
    total = (await db.collectionGroup(name).count().get()).data().count;
    console.log(`  ${name} (all wallets): would delete ${total} docs`);
    return total;
  }
  while (true) {
    const snap = await db.collectionGroup(name).limit(2000).get();
    if (snap.empty) break;
    let batch = db.batch(), inBatch = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      if (++inBatch >= 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch > 0) await batch.commit();
    total += snap.size;
    if (snap.size < 2000) break;
  }
  console.log(`  ${name} (all wallets): deleted ${total} docs`);
  return total;
}

// 1. Drafts (history + live) — keep the draftTracker doc, we reset it below.
//    MUST be recursive: draft docs carry cards/state/scores/smsNotificationClaims
//    subcollections that a plain doc-delete would orphan (see the 2,507-ghost
//    incident). wipeCollectionRecursive uses listDocuments + recursiveDelete.
console.log('DRAFTS + LIVE STATE');
await wipeCollectionRecursive('drafts', { skipDocId: 'draftTracker' });
const rtdbSnap = await rtdb.ref('drafts').once('value');
const rtdbN = rtdbSnap.exists() ? Object.keys(rtdbSnap.val()).length : 0;
if (GO && rtdbN) await rtdb.ref('drafts').remove();
console.log(`  RTDB drafts/ node: ${GO ? 'removed' : 'would remove'} ${rtdbN} entries`);

// 2. ID-keyed stores — the cross-era ghost + synthetic-id-collision sources.
//    draftTokens = the GLOBAL collision registry: a stale row here makes the Go
//    engine register a new mint under a synthetic id (the leading-zero ghost
//    root cause). draftTokenMetadata = prior-era finalize/render docs keyed by
//    on-chain id. marketplace_index = card index. pass_origin = free/paid origin.
//    All keyed by bare token-id → MUST be cleared so new low ids start clean.
console.log('\nTEAM/PASS METADATA (id-keyed — clears era-reuse + synthetic-id collisions)');
await wipeCollection('draftTokens');
await wipeCollection('draftTokenMetadata');
await wipeCollection('marketplace_index');
await wipeCollection('pass_origin');

// 3. Every wallet's pass ledger (carries PassType/LeagueId/RealTokenId per token)
//    — bulk across all 17k wallets via collectionGroup, not one-by-one.
console.log('\nPASS LEDGERS — every wallet to 0');
await wipeCollectionGroup('validDraftTokens');
await wipeCollectionGroup('usedDraftTokens');

// 4. Per-user progress subcollections — complete clean slate.
//    Wheel (period config + wheelSpins history) is deliberately PRESERVED:
//    separate provably-fair VRF system, not part of the contract swap.
console.log('\nPER-USER PROGRESS (complete wipe — bulk across all users)');
for (const sub of ['promos', 'badges', 'draftHistory', 'standings']) {
  await wipeCollectionGroup(sub);
}
// Reset the pass/draft counters on every account (keep the accounts).
// draftPasses (paid) AND freeDrafts (free) — the header shows their SUM, both
// recompute from the now-empty ledger so resetting them sticks. jackpotEntries
// is the referral-jackpot promo counter (promos were wiped above).
const COUNTER_FIELDS = ['draftPasses', 'freeDrafts', 'jackpotEntries'];
const users = await db.collection('v2_users').get();
let countersReset = 0, batch = db.batch(), inBatch = 0;
for (const u of users.docs) {
  const d = u.data();
  const patch = {};
  for (const f of COUNTER_FIELDS) if (typeof d[f] === 'number' && d[f] !== 0) patch[f] = 0;
  if (Object.keys(patch).length) {
    countersReset++;
    if (GO) {
      batch.set(u.ref, patch, { merge: true });
      if (++inBatch >= 450) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
  }
}
if (GO && inBatch > 0) await batch.commit();
console.log(`  v2_users counters (draftPasses/freeDrafts/jackpotEntries): ${GO ? 'reset' : 'would reset'} ${countersReset} accounts → 0`);
console.log('  wheelSpins + pendingWheelWinnings + wheel period: PRESERVED (separate provably-fair system)');

// 5. Dashboard / global league counter → 0  (drafts/draftTracker).
const trackerRef = db.collection('drafts').doc('draftTracker');
const tracker = await trackerRef.get();
if (tracker.exists) {
  const t = tracker.data();
  const zeroed = {};
  for (const k of Object.keys(t)) if (typeof t[k] === 'number') zeroed[k] = 0;
  if (GO) await trackerRef.set(zeroed, { merge: true });
  console.log(`  drafts/draftTracker: ${GO ? 'reset' : 'would reset'} FilledLeaguesCount ${t.FilledLeaguesCount ?? '?'} → 0 (dashboard 0/100, next League #1)`);
} else {
  console.log('  drafts/draftTracker: absent (nothing to reset)');
}

// 6. Confirm protected stores are untouched.
console.log('\nPROTECTED (not touched):');
for (const d of ['batchProof', 'batchProofMerkle', 'merkleRoundState']) {
  const s = await db.collection('system_config').doc(d).get();
  console.log(`  system_config/${d}: ${s.exists ? 'present ✓' : 'absent'}`);
}
console.log(`  merkle_rounds: ${(await db.collection('merkle_rounds').count().get()).data().count} docs (VRF — Step 2 handles)`);
console.log(`  web2_social_identities: ${(await db.collection('web2_social_identities').count().get()).data().count} docs (kept)`);

console.log(`\n================ ${GO ? 'WIPE COMPLETE' : 'DRY-RUN COMPLETE — nothing changed'} ================`);
if (!GO) console.log('Re-run with  --go  to execute.\n');
process.exit(0);
