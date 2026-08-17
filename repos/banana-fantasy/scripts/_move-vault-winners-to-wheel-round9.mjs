/**
 * ONE-OFF (2026-08-17, Boris): retire The Banana Vault. Its 3 Vault-1 seat
 * winners move from the vault-only lobby (queue round 14 / 2025-slow-draft-50)
 * into the open WHEEL Jackpot lobby round 9 / 2025-slow-draft-20 (6/10 → 9/10).
 * Verified none of the three already holds a seat there. Round 14 + draft-50
 * are then REPURPOSED (not deleted) as the Around The Banana round-three lobby:
 * queue source 'vault' → 'atb', Go league Source → 'promo'.
 *
 * Steps (each idempotent / re-runnable):
 *   1. queue tx: round 9 += the 3 (wallet, joinedAt, tokenId); round 14 → [] + 'atb'
 *   2. Go join-special-draft ×3 on draft-20 (mints the seat token bound to the pass)
 *   3. draft-50: drop the 3 CurrentUsers, NumPlayers 0, Source 'promo'; delete
 *      their special-* seat tokens (canonical + used + league card + metadata);
 *      RTDB numPlayers 0
 *   4. banana_vault/state: closesAtMs = now, retiredAt stamped
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('/Users/borisvagner/banana-fantasy/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = admin.firestore();
const rt = admin.database();
const GO = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

const FROM_ROUND = 14, FROM_DRAFT = '2025-slow-draft-50';
const TO_ROUND = 9, TO_DRAFT = '2025-slow-draft-20';
const MOVERS = [
  { wallet: '0x9699a07e38f185a76facbd8bfbe7b9fd99e8602f', tokenId: '8295' },
  { wallet: '0x84df49b1d4fdcee1e3b410669b7e5087412b411b', tokenId: '8296' },
  { wallet: '0x8d1ae27f10654d8f2604feae84485b84a7ad0da7', tokenId: '8299' },
];
const DRY = process.argv.includes('--dry');

// ---- 1. queue ----
const queueRef = db.collection('v2_queues').doc('jackpot');
await db.runTransaction(async (tx) => {
  const q = (await tx.get(queueRef)).data();
  const from = q.rounds.find(r => r.roundId === FROM_ROUND);
  const to = q.rounds.find(r => r.roundId === TO_ROUND);
  if (!from || !to) throw new Error('rounds missing');
  if (to.status !== 'filling' || to.draftId !== TO_DRAFT) throw new Error(`round ${TO_ROUND} unexpected: ${to.status} ${to.draftId}`);
  if (from.draftId !== FROM_DRAFT) throw new Error(`round ${FROM_ROUND} unexpected draftId ${from.draftId}`);
  for (const mv of MOVERS) {
    // Re-runnable: our own token already there is fine; a DIFFERENT seat = abort.
    if (to.members.some(x => x.wallet === mv.wallet && x.tokenId !== mv.tokenId)) throw new Error(`${mv.wallet} ALREADY in round ${TO_ROUND} — abort`);
  }
  const toAdd = MOVERS.filter(mv => !to.members.some(x => x.tokenId === mv.tokenId));
  if (to.members.length + toAdd.length > 10) throw new Error('would overflow round 9');
  const now = Date.now();
  for (const mv of MOVERS) {
    if (!to.members.some(x => x.tokenId === mv.tokenId)) to.members.push({ wallet: mv.wallet, joinedAt: now, tokenId: mv.tokenId });
  }
  from.members = from.members.filter(x => !MOVERS.some(mv => mv.wallet === x.wallet || mv.tokenId === x.tokenId));
  from.source = 'atb';
  console.log(`queue: round ${TO_ROUND} → ${to.members.length}/10, round ${FROM_ROUND} → ${from.members.length}/10 source=${from.source}`);
  if (!DRY) tx.set(queueRef, q);
});

// ---- 2. Go join draft-20 ----
for (const mv of MOVERS) {
  if (DRY) { console.log('DRY skip go join', mv.wallet); continue; }
  const res = await fetch(`${GO}/staging/join-special-draft`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId: TO_DRAFT, wallet: mv.wallet, tokenId: mv.tokenId }),
  });
  const txt = await res.text();
  console.log('go join', mv.wallet, res.status, txt.slice(0, 200));
  if (!res.ok) throw new Error('go join failed — stop here, queue already updated; rerun to retry');
}

// ---- 3. draft-50 surgery ----
const SKIP_SURGERY = process.argv.includes('--skip-surgery');
if (SKIP_SURGERY) { console.log('--skip-surgery: leaving draft-50 untouched (rerun without flag to finish)'); }
const leagueRef = db.collection('drafts').doc(FROM_DRAFT);
const removedTokens = [];
if (!SKIP_SURGERY) await db.runTransaction(async (tx) => {
  const l = (await tx.get(leagueRef)).data();
  const keep = [], drop = [];
  for (const u of l.CurrentUsers ?? []) {
    (MOVERS.some(mv => mv.wallet === String(u.OwnerId).toLowerCase()) ? drop : keep).push(u);
  }
  removedTokens.push(...drop.map(u => ({ id: u.TokenId, wallet: String(u.OwnerId).toLowerCase() })));
  console.log(`draft-50: dropping ${drop.length} seats, keeping ${keep.length}; Source ${l.Source} → promo`);
  if (!DRY) tx.update(leagueRef, { CurrentUsers: keep, NumPlayers: keep.length, Source: 'promo' });
});
for (const t of removedTokens) {
  const paths = [
    db.collection('draftTokens').doc(t.id),
    db.collection(`owners/${t.wallet}/usedDraftTokens`).doc(t.id),
    db.collection(`drafts/${FROM_DRAFT}/cards`).doc(t.id),
    db.collection('draftTokenMetadata').doc(t.id),
  ];
  for (const ref of paths) {
    const ex = (await ref.get()).exists;
    console.log(`  ${DRY ? 'would delete' : 'delete'} ${ref.path} (exists=${ex})`);
    if (!DRY && ex) await ref.delete();
  }
}
if (!DRY && !SKIP_SURGERY) await rt.ref(`drafts/${FROM_DRAFT}`).update({ numPlayers: 0 });
const stateDocs = await db.collection(`drafts/${FROM_DRAFT}/state`).get();
console.log('draft-50 state subcollection docs:', stateDocs.docs.map(d => d.id + ':' + JSON.stringify(d.data()).slice(0, 120)));

// ---- 4. close vault ----
if (!DRY) await db.collection('banana_vault').doc('state').set({ closesAtMs: Date.now(), retiredAt: new Date().toISOString(), retiredReason: 'boris-2026-08-17-atb-relaunch' }, { merge: true });
console.log(DRY ? 'DRY RUN done' : 'done');
process.exit(0);
