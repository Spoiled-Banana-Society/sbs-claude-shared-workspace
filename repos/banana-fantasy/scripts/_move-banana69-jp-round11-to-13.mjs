/**
 * One-off ops (ticket-2661, Richard 2026-08-24): couch and Banana69 are the SAME
 * PERSON and both landed in jackpot round 11 (2025-slow-draft-33, 9/10).
 * Move Banana69's wheel Jackpot seat (NFT 9792, joined last, 8/24 19:33Z) OUT of
 * round 11 and INTO round 13 (2025-slow-draft-46, 1/10, same 'wheel' source) —
 * exactly where the new same-person rule (lib/linkedWallets.ts) would have put it.
 *
 * Runbook = scripts/_move-roarstone-into-promo-jackhof.mjs (move INTO an existing
 * league): queue edit -> POST /api/queues/create-draft (ensureSpecialDraftSeat ->
 * Go join-special-draft binds RealTokenId itself) -> drop the old seat.
 *
 * Run:  node scripts/_move-banana69-jp-round11-to-13.mjs            (dry run)
 *       node scripts/_move-banana69-jp-round11-to-13.mjs --commit   (execute)
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();
const rtdb = admin.database();

const COMMIT = process.argv.includes('--commit');
const TYPE = 'jackpot';
const WALLET = '0xa551f64ae2791d0fc6c8cad23c22ac3529dbbd2e'; // Banana69
const LINKED = '0x466d16ec1724f08aaeec2399816160f0d95d9d4f'; // couch (same person) — must stay in round 11
const NFT = '9792';                                          // Banana69's wheel Jackpot pass
const FROM_ROUND = 11, FROM_DRAFT = '2025-slow-draft-33', FROM_N = 9;
const TO_ROUND = 13,   TO_DRAFT = '2025-slow-draft-46',   TO_N = 1;
const SITE = 'https://sbsfantasy.com';
const CONTRACT = '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80';

const log = (...a) => console.log(...a);
const step = (n, s) => log(`\n=== ${n}. ${s} ===`);

async function onchainOwner(tokenId) {
  const data = '0x6352211e' + BigInt(tokenId).toString(16).padStart(64, '0');
  const r = await fetch('https://mainnet.base.org', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CONTRACT, data }, 'latest'] }),
  });
  return ('0x' + (await r.json()).result.slice(-40)).toLowerCase();
}

// ---------- PRE-FLIGHT ----------
step(0, 'Pre-flight');
const owner = await onchainOwner(NFT);
if (owner !== WALLET) throw new Error(`ABORT: NFT ${NFT} on-chain owner is ${owner}, not Banana69`);
log(`NFT ${NFT} on-chain owner = ${owner} (Banana69) OK`);

const queueRef = db.collection('v2_queues').doc(TYPE);
const q = (await queueRef.get()).data();
const rFrom = (q.rounds || []).find(r => r.roundId === FROM_ROUND);
const rTo = (q.rounds || []).find(r => r.roundId === TO_ROUND);
if (!rFrom || !rTo) throw new Error('ABORT: round missing');
if (rFrom.status !== 'filling' || rTo.status !== 'filling') throw new Error(`ABORT: status from=${rFrom.status} to=${rTo.status}`);
if (rFrom.draftId !== FROM_DRAFT || rTo.draftId !== TO_DRAFT) throw new Error(`ABORT: draftId from=${rFrom.draftId} to=${rTo.draftId}`);
if ((rFrom.source ?? 'wheel') !== 'wheel' || (rTo.source ?? 'wheel') !== 'wheel') throw new Error('ABORT: source mismatch');
const mine = rFrom.members.find(x => String(x.tokenId) === NFT && x.wallet.toLowerCase() === WALLET);
if (!mine) throw new Error(`ABORT: token ${NFT}/Banana69 not in round ${FROM_ROUND}`);
if (!rFrom.members.some(x => x.wallet.toLowerCase() === LINKED)) throw new Error('ABORT: couch not in round 11 — premise changed');
if (rFrom.members.length !== FROM_N) throw new Error(`ABORT: round ${FROM_ROUND} has ${rFrom.members.length}, expected ${FROM_N}`);
if (rTo.members.length !== TO_N) throw new Error(`ABORT: round ${TO_ROUND} has ${rTo.members.length}, expected ${TO_N}`);
if (rTo.members.some(x => [WALLET, LINKED].includes(x.wallet.toLowerCase()))) throw new Error('ABORT: same person already in round 13');
log(`round ${FROM_ROUND}: ${rFrom.members.length} members -> ${FROM_DRAFT}`);
log(`round ${TO_ROUND}: ${rTo.members.length} members -> ${TO_DRAFT}`);

for (const d of [FROM_DRAFT, TO_DRAFT]) {
  if ((await db.collection('drafts').doc(d).collection('state').doc('info').get()).exists) throw new Error(`ABORT: ${d} has started`);
}
const fromLeague = (await db.collection('drafts').doc(FROM_DRAFT).get()).data();
const toLeague = (await db.collection('drafts').doc(TO_DRAFT).get()).data();
if (fromLeague.NumPlayers !== FROM_N) throw new Error(`ABORT: ${FROM_DRAFT} NumPlayers ${fromLeague.NumPlayers}`);
if (toLeague.NumPlayers !== TO_N) throw new Error(`ABORT: ${TO_DRAFT} NumPlayers ${toLeague.NumPlayers}`);
const oldSeatRow = (fromLeague.CurrentUsers || []).find(u => u.OwnerId.toLowerCase() === WALLET);
if (!oldSeatRow) throw new Error(`ABORT: Banana69 holds no seat in ${FROM_DRAFT}`);
const OLD_SEAT = oldSeatRow.TokenId;
const oldSeatDoc = (await db.collection('draftTokens').doc(OLD_SEAT).get()).data() || {};
if (String(oldSeatDoc.RealTokenId) !== NFT) throw new Error(`ABORT: old seat ${OLD_SEAT} RealTokenId=${oldSeatDoc.RealTokenId}, expected ${NFT}`);
log(`neither draft started; ${FROM_DRAFT} Banana69 seat token = ${OLD_SEAT} (RealTokenId ${NFT})`);

if (!COMMIT) {
  log('\n--- DRY RUN, nothing written. Planned changes: ---');
  log(`1. queue ${TYPE}: move Banana69 (token ${NFT}) round ${FROM_ROUND} -> ${TO_ROUND} (${FROM_N}->${FROM_N-1}, ${TO_N}->${TO_N+1})`);
  log(`2. POST ${SITE}/api/queues/create-draft {${TYPE}, roundId ${TO_ROUND}} -> joins ${TO_DRAFT} (Go binds RealTokenId ${NFT})`);
  log(`3. ${FROM_DRAFT}: drop seat ${OLD_SEAT}, NumPlayers ${FROM_N}->${FROM_N-1}; delete seat docs; RTDB numPlayers`);
  process.exit(0);
}

// ---------- 1. QUEUE ----------
step(1, `Queue: move member round ${FROM_ROUND} -> ${TO_ROUND}`);
await db.runTransaction(async tx => {
  const cur = (await tx.get(queueRef)).data();
  const to = cur.rounds.find(r => r.roundId === TO_ROUND);
  const from = cur.rounds.find(r => r.roundId === FROM_ROUND);
  if (to.members.length !== TO_N || from.members.length !== FROM_N) throw new Error(`race: to=${to.members.length} from=${from.members.length}`);
  from.members = from.members.filter(x => String(x.tokenId) !== NFT);
  to.members.push({ wallet: mine.wallet, joinedAt: mine.joinedAt, tokenId: NFT });
  tx.set(queueRef, cur);
});
{
  const a = (await queueRef.get()).data();
  log(`round ${FROM_ROUND} now ${a.rounds.find(r=>r.roundId===FROM_ROUND).members.length}; round ${TO_ROUND} now ${a.rounds.find(r=>r.roundId===TO_ROUND).members.length}`);
}

// ---------- 2. Seat in the new league ----------
step(2, `Join ${TO_DRAFT} via the sanctioned path`);
const res = await fetch(`${SITE}/api/queues/create-draft`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: WALLET, queueType: TYPE, roundId: TO_ROUND }),
});
const body = await res.text();
log(`create-draft -> ${res.status} ${body}`);
if (!res.ok) throw new Error(`ABORT after queue edit: join failed. Round ${TO_ROUND} lists Banana69 but no seat — re-run step 2 only.`);
let NEW_SEAT;
{
  const l = (await db.collection('drafts').doc(TO_DRAFT).get()).data();
  const seat = (l.CurrentUsers || []).find(u => u.OwnerId.toLowerCase() === WALLET);
  log(`${TO_DRAFT} NumPlayers -> ${l.NumPlayers}; new seat token = ${seat ? seat.TokenId : 'MISSING'}`);
  if (!seat) throw new Error('ABORT: join ok but no seat row');
  NEW_SEAT = seat.TokenId;
  const bound = (await db.collection('draftTokens').doc(NEW_SEAT).get()).data() || {};
  log(`RealTokenId on new seat = ${bound.RealTokenId ?? '(unset)'} (expect ${NFT})`);
  if (String(bound.RealTokenId) !== NFT) throw new Error('ABORT: new seat not bound to NFT — fix by hand before removing old seat');
}

// ---------- 3. Remove old seat ----------
step(3, `Remove old seat ${OLD_SEAT} from ${FROM_DRAFT}`);
await db.runTransaction(async tx => {
  const ref = db.collection('drafts').doc(FROM_DRAFT);
  const l = (await tx.get(ref)).data();
  if (l.NumPlayers !== FROM_N) throw new Error(`race: ${FROM_DRAFT} NumPlayers ${l.NumPlayers}`);
  l.CurrentUsers = (l.CurrentUsers || []).filter(u => u.TokenId !== OLD_SEAT);
  l.NumPlayers = l.CurrentUsers.length;
  tx.set(ref, l);
});
const after = (await db.collection('drafts').doc(FROM_DRAFT).get()).data();
log(`${FROM_DRAFT} NumPlayers -> ${after.NumPlayers}`);
for (const ref of [
  db.collection('draftTokens').doc(OLD_SEAT),
  db.collection('draftTokenMetadata').doc(OLD_SEAT),
  db.collection('owners').doc(WALLET).collection('usedDraftTokens').doc(OLD_SEAT),
  db.collection('owners').doc(WALLET).collection('validDraftTokens').doc(OLD_SEAT),
  db.collection('drafts').doc(FROM_DRAFT).collection('cards').doc(OLD_SEAT),
]) { await ref.delete(); log(`  deleted ${ref.path}`); }
await rtdb.ref(`drafts/${FROM_DRAFT}`).update({ numPlayers: after.NumPlayers });
log(`RTDB drafts/${FROM_DRAFT}.numPlayers -> ${after.NumPlayers}`);
log(`\nDONE. Banana69 (NFT ${NFT}) moved ${FROM_DRAFT} (now ${after.NumPlayers}/10) -> ${TO_DRAFT} (seat ${NEW_SEAT}).`);
process.exit(0);
