#!/usr/bin/env node
// Phase-2 staging wipe: the BBB4-stale stores the first wipe missed. Clears the
// wheel filling lobbies (v2_queues) + token-id-keyed league map + marketplace
// state. DRY-RUN by default; --go to execute.  bash ~/wipe2.sh [--go]
//
// EXPLICITLY DOES NOT TOUCH (verified different products / reference / financial):
//   cards, cardMetadata (Genesis 10k), playoffCards, playoffCardMetadata
//   (Playoff S1 15k), scores, stats, playerStats*, 2023DraftTokens* (old season
//   archive), transactions, withdrawalRequests, claims, v2_purchases, all logs,
//   system_config, merkle_rounds, wheel_periods, wheelSpins, web2_social_identities.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const GO = process.argv.includes('--go');
console.log(`\n===== PHASE-2 WIPE — ${GO ? '🔴 EXECUTE' : '🟡 DRY-RUN (nothing deleted)'} =====\n`);

// 1. v2_queues — wheel JP/HOF filling lobbies. Reset each doc's rounds to []
//    (removes stale wheel-won passes like #1556/#1454). Queue docs themselves
//    stay so the wheel can fill fresh rounds.
console.log('WHEEL FILLING LOBBIES (v2_queues)');
const queues = await db.collection('v2_queues').get();
for (const q of queues.docs) {
  const rounds = q.data().rounds || [];
  const members = rounds.reduce((s,r)=>s+(r.members?.length||0),0);
  if (rounds.length === 0) continue;
  console.log(`  ${q.id}: ${GO?'cleared':'would clear'} ${rounds.length} rounds / ${members} members`);
  if (GO) await q.ref.set({ rounds: [] }, { merge: true });
}

// 2. Collection wipes (BBB4-stale, id-keyed / marketplace state).
async function wipe(name) {
  const snap = await db.collection(name).get();
  if (!GO) { console.log(`  ${name}: would delete ${snap.size} docs`); return; }
  let batch = db.batch(), n = 0;
  for (const d of snap.docs) { batch.delete(d.ref); if (++n % 450 === 0) { await batch.commit(); batch = db.batch(); } }
  if (n % 450 !== 0) await batch.commit();
  console.log(`  ${name}: deleted ${snap.size} docs`);
}
console.log('\nTOKEN-ID MAP + MARKETPLACE STATE');
for (const c of ['nft_league_map','active_offers','active_listings','marketplace_activity','marketplace_watchlist']) {
  await wipe(c);
}

console.log(`\n===== ${GO ? 'PHASE-2 COMPLETE' : 'DRY-RUN COMPLETE — nothing changed'} =====`);
if (!GO) console.log('Re-run with --go to execute.\n');
process.exit(0);
