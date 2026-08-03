/**
 * Move the HOF #27 (2025-slow-draft-19) seat bound to wheel pass NFT 3677 from
 * Kiely to Odin7557 — the pass's real on-chain owner since 2026-07-30 20:12 UTC,
 * ~2 days BEFORE the round filled (2026-08-01 19:14 UTC).
 *
 * Why by hand: the sanctioned path (Go /staging/swap-special-draft-member) is
 * hard-rejected once NumPlayers >= 10 ("seats lock at 10/10"), and this league
 * filled and started before anyone noticed the drift. Nothing else can move it.
 *
 * The seat keeps its EXISTING CardId (special-1785100273150-e0fe12) rather than
 * minting a fresh one like the Go swap does: mid-draft that id is referenced from
 * CurrentUsers, DraftOrder and the seat's 15 pre-stamped summary slots, and
 * re-plumbing it everywhere buys nothing. RealTokenId stays "3677" — that binding
 * is what makes Odin the rightful holder in the first place.
 *
 * ⚠️ TIMING: the WS server re-Sets the WHOLE state/info doc (DraftOrder included)
 * from its in-memory copy on every pick — models/draft-info.go switchDrafter ->
 * CreateOrUpdateDocument, which is a full Set. A room instance that is live in
 * memory while this runs will revert DraftOrder on its next pick. Run only when
 * state/connectionList is all-false, and re-verify after the next pick lands.
 *
 * Dry-run by default. Pass --commit to execute.
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const COMMIT = process.argv.includes('--commit');
const src = readFileSync('/Users/richardvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const sa = JSON.parse(Buffer.from(src.match(/STAGING_SA_B64 = '([^']+)'/)[1], 'base64').toString('utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();

const ID = '2025-slow-draft-19';
const KIELY = '0xe0fe125038decff508d0547086aedf44da43b798';
const ODIN = '0xe062a4884c8fc1832af104c66daa5a95d279391e';
const CARD = 'special-1785100273150-e0fe12';
const TOKEN = '3677';
const state = db.collection('drafts').doc(ID).collection('state');
const plan = [];
const step = (what, detail) => { plan.push(what); console.log(`  ${COMMIT ? '✓' : '·'} ${what}${detail ? ` — ${detail}` : ''}`); };

// ---- 0. Pre-flight ------------------------------------------------------
console.log(`=== pre-flight (${COMMIT ? 'COMMIT' : 'DRY RUN'})`);
const ownerRes = await fetch('https://mainnet.base.org', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0xadf5b9b46616de6d073F226e7b7C532aE2CFFB80', data: '0x6352211e' + BigInt(TOKEN).toString(16).padStart(64, '0') }, 'latest'] }),
});
const owner = '0x' + (await ownerRes.json()).result.slice(-40).toLowerCase();
console.log(`  ownerOf(${TOKEN}) = ${owner}`);
if (owner !== ODIN) { console.error('  ABORT: on-chain owner is not Odin — do not move this seat.'); process.exit(1); }

const cl = (await state.doc('connectionList').get()).data()?.List || {};
const connected = Object.entries(cl).filter(([, v]) => v).map(([k]) => k);
console.log(`  connected right now: ${connected.length ? connected.join(', ') : 'nobody'}`);
if (connected.length) console.log('  ⚠️  a live room may revert state/info on its next pick — re-verify after.');

const info = (await state.doc('info').get()).data();
console.log(`  draft at pick ${info.CurrentPickNumber}, drafter ${info.CurrentDrafter}`);
const seatIdx = (info.DraftOrder || []).findIndex(o => String(o.OwnerId || '').toLowerCase() === KIELY);
if (seatIdx === -1) { console.error('  ABORT: Kiely holds no slot in DraftOrder (already moved?).'); process.exit(1); }
console.log(`  seat = DraftOrder[${seatIdx}] (pick ${seatIdx + 1} of round 1)`);
if (info.CurrentPickNumber > seatIdx + 1) console.log('  ⚠️  the seat is already PAST its first pick — check what auto-picked.');

// Odin's profile, for the roster PFP block
const odinDoc = (await db.collection('v2_users').doc(ODIN).get()).data() || {};
const odinName = odinDoc.username || odinDoc.handle || 'Odin7557';
console.log(`  buyer display name = ${odinName}`);

console.log('\n=== writes');
const batchOps = [];

// ---- 1. League doc CurrentUsers ----------------------------------------
const leagueRef = db.collection('drafts').doc(ID);
const league = (await leagueRef.get()).data();
const cuIdx = (league.CurrentUsers || []).findIndex(u => String(u.OwnerId || '').toLowerCase() === KIELY);
if (cuIdx >= 0) {
  const next = [...league.CurrentUsers];
  next[cuIdx] = { OwnerId: ODIN, TokenId: CARD };
  batchOps.push(() => leagueRef.update({ CurrentUsers: next }));
  step(`drafts/${ID}.CurrentUsers[${cuIdx}].OwnerId -> Odin`);
}

// ---- 2. state/info DraftOrder ------------------------------------------
{
  const next = [...info.DraftOrder];
  next[seatIdx] = { OwnerId: ODIN, TokenId: CARD };
  const patch = { DraftOrder: next };
  // If the seat is somehow on the clock right now, move CurrentDrafter too.
  if (String(info.CurrentDrafter || '').toLowerCase() === KIELY) patch.CurrentDrafter = ODIN;
  batchOps.push(() => state.doc('info').update(patch));
  step(`state/info.DraftOrder[${seatIdx}].OwnerId -> Odin${patch.CurrentDrafter ? ' (+ CurrentDrafter)' : ''}`);
}

// ---- 3. state/summary — the seat's 15 pre-stamped picks ------------------
{
  const summary = (await state.doc('summary').get()).data() || {};
  const rows = [...(summary.Summary || [])];
  const touched = [];
  rows.forEach((r, i) => {
    if (String(r?.PlayerInfo?.OwnerAddress || '').toLowerCase() !== KIELY) return;
    rows[i] = { ...r, PlayerInfo: { ...r.PlayerInfo, OwnerAddress: ODIN } };
    touched.push(r.PlayerInfo.PickNum);
  });
  if (touched.length) {
    batchOps.push(() => state.doc('summary').update({ Summary: rows }));
    step(`state/summary — ${touched.length} slots -> Odin`, `picks ${touched.join(', ')}`);
  }
}

// ---- 4. state/playerState — anything the seat already drafted -----------
{
  const ps = (await state.doc('playerState').get()).data() || {};
  const owned = Object.entries(ps).filter(([, v]) => String(v?.OwnerAddress || '').toLowerCase() === KIELY);
  if (owned.length) {
    const patch = {};
    for (const [k, v] of owned) patch[k] = { ...v, OwnerAddress: ODIN };
    batchOps.push(() => state.doc('playerState').update(patch));
    step(`state/playerState — ${owned.length} drafted players -> Odin`, owned.map(([k]) => k).join(', '));
  } else {
    step('state/playerState — nothing drafted by this seat yet', 'no-op');
  }
}

// ---- 5. state/rosters — rekey the roster to Odin -------------------------
{
  const ros = (await state.doc('rosters').get()).data() || {};
  const mine = (ros.Rosters || {})[KIELY];
  if (mine) {
    const moved = {
      ...mine,
      PFP: {
        NftContract: '',
        DisplayName: odinName,
        ImageUrl: odinDoc.pfpUrl || odinDoc.profileImageUrl || '',
      },
    };
    batchOps.push(() => state.doc('rosters').update({
      [`Rosters.${ODIN}`]: moved,
      [`Rosters.${KIELY}`]: admin.firestore.FieldValue.delete(),
    }));
    step('state/rosters — roster rekeyed Kiely -> Odin', `PFP set to ${odinName}`);
  }
}

// ---- 6. state/connectionList --------------------------------------------
{
  if (Object.prototype.hasOwnProperty.call(cl, KIELY)) {
    batchOps.push(() => state.doc('connectionList').update({
      [`List.${ODIN}`]: false,
      [`List.${KIELY}`]: admin.firestore.FieldValue.delete(),
    }));
    step('state/connectionList — Kiely -> Odin');
  }
}

// ---- 7. Seat card + token docs (mirrors the Go swap's bookkeeping) -------
{
  const cardRef = db.collection('drafts').doc(ID).collection('cards').doc(CARD);
  batchOps.push(() => cardRef.update({ OwnerId: ODIN }));
  step(`drafts/${ID}/cards/${CARD}.OwnerId -> Odin`, `RealTokenId stays ${TOKEN}`);

  batchOps.push(() => db.collection('draftTokens').doc(CARD).update({ OwnerId: ODIN }));
  step(`draftTokens/${CARD}.OwnerId -> Odin`);

  const usedSnap = await db.collection(`owners/${KIELY}/usedDraftTokens`).doc(CARD).get();
  if (usedSnap.exists) {
    const data = { ...usedSnap.data(), OwnerId: ODIN };
    batchOps.push(() => db.collection(`owners/${ODIN}/usedDraftTokens`).doc(CARD).set(data));
    batchOps.push(() => db.collection(`owners/${KIELY}/usedDraftTokens`).doc(CARD).delete());
    step(`owners/{wallet}/usedDraftTokens/${CARD} — moved Kiely -> Odin`);
  }
}

// ---- 8. Queue bookkeeping (v2_queues/hof round 6) ------------------------
{
  const qRef = db.collection('v2_queues').doc('hof');
  const q = (await qRef.get()).data();
  const rounds = [...(q.rounds || [])];
  const ri = rounds.findIndex(r => r.roundId === 6);
  const mi = ri >= 0 ? (rounds[ri].members || []).findIndex(m => String(m.tokenId) === TOKEN) : -1;
  if (mi >= 0 && String(rounds[ri].members[mi].wallet).toLowerCase() !== ODIN) {
    const members = [...rounds[ri].members];
    members[mi] = { ...members[mi], wallet: ODIN };
    rounds[ri] = { ...rounds[ri], members };
    batchOps.push(() => qRef.update({ rounds }));
    step('v2_queues/hof round 6 member wallet -> Odin', 'stops the overlay disagreeing with stored state');
  }
}

// ---- 9. RTDB nudge so open lobbies re-resolve identities -----------------
batchOps.push(() => admin.database().ref(`drafts/${ID}`).update({ numPlayers: league.NumPlayers }));
step(`RTDB drafts/${ID}.numPlayers re-set`, 'pings listeners, value unchanged');

// ---- execute ------------------------------------------------------------
if (!COMMIT) {
  console.log(`\n${plan.length} writes planned. Re-run with --commit to execute.`);
  process.exit(0);
}
console.log('\n=== executing');
for (const op of batchOps) await op();
console.log(`${batchOps.length} writes committed.`);

// ---- verify -------------------------------------------------------------
console.log('\n=== verify');
const v1 = (await state.doc('info').get()).data();
console.log(`  DraftOrder[${seatIdx}] =`, JSON.stringify(v1.DraftOrder[seatIdx]));
const v2 = (await leagueRef.get()).data();
console.log(`  CurrentUsers[${cuIdx}] =`, JSON.stringify(v2.CurrentUsers[cuIdx]));
const v3 = (await state.doc('summary').get()).data();
console.log(`  summary slots still on Kiely =`, (v3.Summary || []).filter(r => String(r?.PlayerInfo?.OwnerAddress || '').toLowerCase() === KIELY).length);
const v4 = (await db.collection('drafts').doc(ID).collection('cards').doc(CARD).get()).data();
console.log(`  card OwnerId = ${v4.OwnerId} / RealTokenId = ${v4.RealTokenId}`);
process.exit(0);
