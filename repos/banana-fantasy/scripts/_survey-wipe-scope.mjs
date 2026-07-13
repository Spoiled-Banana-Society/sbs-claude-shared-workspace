#!/usr/bin/env node
// READ-ONLY survey of staging data ahead of the full rebuild wipe.
// Deletes NOTHING. Reads the Firebase service account from .env.production
// (same as your other scripts). Run: node scripts/_survey-wipe-scope.mjs
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';

const envText = readFileSync('.env.production', 'utf8');
const saMatch = envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m);
if (!saMatch) { console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.production'); process.exit(1); }
const sa = JSON.parse(Buffer.from(saMatch[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = getFirestore();
const rtdb = getDatabase();

const HUMAN_WALLETS = {
  'Boris (drafting)':   '0x438bbe98eed1dd2df244b007dab0583cc9be72e0',
  'Boris (old Privy)':  '0xd3301bc039faf4223da98bceb5fb81abc9399362',
  'Richard':            '0x2e64db49fc597a731091471607f6cd0251d7eafb',
  'Richard (r8 test)':  '0xbd2e09c009a7834cd32f9fa8a87073c5b3083f11',
};

const count = async (coll) => (await db.collection(coll).count().get()).data().count;

console.log('================ STAGING WIPE SURVEY (read-only) ================\n');

// --- WOULD DELETE ---
console.log('WOULD DELETE:');
const draftsTotal = await count('drafts');
console.log(`  drafts collection (incl. draftTracker doc): ${draftsTotal}`);
console.log(`  marketplace_index docs:                     ${await count('marketplace_index')}`);
const rtdbSnap = await rtdb.ref('drafts').once('value');
console.log(`  RTDB drafts/ node entries:                  ${rtdbSnap.exists() ? Object.keys(rtdbSnap.val()).length : 0}`);

console.log('\n  Human test-wallet pass ledgers + counters:');
for (const [label, w] of Object.entries(HUMAN_WALLETS)) {
  const valid = (await db.collection(`owners/${w}/validDraftTokens`).count().get()).data().count;
  const used  = (await db.collection(`owners/${w}/usedDraftTokens`).count().get()).data().count;
  const u = await db.collection('v2_users').doc(w).get();
  const passes = u.exists ? (u.data().draftPasses ?? 'n/a') : 'no user doc';
  console.log(`    ${label.padEnd(20)} valid:${String(valid).padStart(4)}  used:${String(used).padStart(4)}  counter:${passes}`);
}

// --- BOT / OTHER WALLET FOOTPRINT (decide whether to include) ---
const ownersSnap = await db.collection('owners').get();
let botWallets = 0, botTokens = 0;
const humanSet = new Set(Object.values(HUMAN_WALLETS));
for (const doc of ownersSnap.docs) {
  if (humanSet.has(doc.id.toLowerCase())) continue;
  const v = (await db.collection(`owners/${doc.id}/validDraftTokens`).count().get()).data().count;
  if (v > 0) { botWallets++; botTokens += v; }
}
console.log(`\n  OTHER wallets (bots/synthetic) holding passes: ${botWallets} wallets, ${botTokens} tokens`);
console.log('    (default = KEEP these so bot-fill drafts still work; say the word to wipe too)');

// --- DRAFT TRACKER (the 0/100 dashboard + League # counter) ---
const tracker = await db.collection('drafts').doc('draftTracker').get();
console.log('\nWOULD RESET (not delete):');
if (tracker.exists) {
  const t = tracker.data();
  console.log(`  drafts/draftTracker  FilledLeaguesCount=${t.FilledLeaguesCount ?? '?'} → 0  (dashboard 0/100, next League #1)`);
} else {
  console.log('  drafts/draftTracker: not present');
}

// --- PROTECTED (never touched) ---
console.log('\nPROTECTED (never touched):');
for (const d of ['batchProof', 'batchProofMerkle', 'merkleRoundState']) {
  const s = await db.collection('system_config').doc(d).get();
  console.log(`  system_config/${d}: ${s.exists ? 'present ✓ (kept)' : 'absent'}`);
}
console.log(`  merkle_rounds docs: ${await count('merkle_rounds')} (VRF — re-randomized in Step 2, not blind-deleted)`);
console.log(`  web2_social_identities docs: ${await count('web2_social_identities')} (prod-pulled, kept)`);

console.log('\n================ END SURVEY — nothing was deleted ================');
process.exit(0);
