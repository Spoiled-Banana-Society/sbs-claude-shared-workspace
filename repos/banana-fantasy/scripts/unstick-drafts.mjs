/**
 * unstick-drafts.mjs — detect & heal draft join/leave "split-brain" safely.
 *
 * WHY THIS EXISTS
 * A draft join and a draft leave in the Go engine are each TWO steps: (1) a
 * Firestore transaction that moves the SEAT (drafts/{L}.CurrentUsers + a pass
 * claim/return), then (2) a SEPARATE, non-transactional sync of the TOKEN's
 * denormalized copies (draftTokens, owners/{w}/validDraftTokens|usedDraftTokens,
 * drafts/{L}/cards). If step 2 is interrupted (e.g. a Firestore write-latency
 * spike → DeadlineExceeded), the seat and the token permanently disagree:
 *
 *   A) ORPHAN TOKEN  — token still bound to league L, but the owner is NOT in
 *      L's roster.  => user is "stuck in a draft they can't leave."
 *   B) SEAT, NO TOKEN — owner IS in L's roster, but the usedDraftTokens / cards
 *      records are missing.  => "joined but the draft doesn't show up for me."
 *
 * This tool finds both and completes the half-finished operation exactly as the
 * engine would have. It touches ONLY genuine mismatches and is a no-op when
 * everything agrees, so it can be run anytime without affecting healthy drafts.
 *
 * USAGE (run from ~/banana-fantasy so firebase-admin resolves):
 *   node scripts/unstick-drafts.mjs                 # DRY RUN — report only
 *   node scripts/unstick-drafts.mjs --wallet=0x..   # DRY RUN, one wallet
 *   node scripts/unstick-drafts.mjs --apply         # heal what it found
 *
 * It NEVER modifies running-engine code — pure data repair, admin SA only.
 */
import admin from 'firebase-admin';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const walletArg = (process.argv.find((a) => a.startsWith('--wallet=')) || '').split('=')[1]?.toLowerCase() || null;

const sa = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();
const rtdb = admin.database();

const lc = (v) => String(v ?? '').toLowerCase();
const SPECIAL_LEVELS = new Set(['Hall of Fame', 'Jackpot']); // wheel-won, excluded from spendable counters

// Mirror lib/passLedger.countSpendableTokens so counters we write match the app.
async function mirrorCounters(wallet) {
  const snap = await db.collection(`owners/${wallet}/validDraftTokens`).get();
  let paid = 0, free = 0;
  snap.forEach((d) => {
    const x = d.data();
    if (SPECIAL_LEVELS.has(String(x.Level ?? '').trim())) return;
    if (lc(x.PassType) === 'free') free += 1; else paid += 1;
  });
  if (APPLY) {
    await db.collection('v2_users').doc(wallet).set(
      { draftPasses: paid, freeDrafts: free, passesSyncedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  return { paid, free };
}

// Complete an interrupted LEAVE: return the orphaned token to spendable and
// scrub its in-use copies. Mirrors models/draft-token.go RemoveTokenFromLeague.
async function healOrphan(wallet, cardId, leagueId) {
  const tokRef = db.collection('draftTokens').doc(cardId);
  const tok = (await tokRef.get()).data();
  if (!tok || lc(tok.OwnerId) !== wallet) return { skipped: 'owner-mismatch' };
  const clean = { ...tok, LeagueId: '', DraftType: '', LeagueDisplayName: '' };
  if (APPLY) {
    await tokRef.set(clean);
    await db.collection(`owners/${wallet}/validDraftTokens`).doc(cardId).set(clean);
    await db.collection(`owners/${wallet}/usedDraftTokens`).doc(cardId).delete().catch(() => {});
    await db.collection(`drafts/${leagueId}/cards`).doc(cardId).delete().catch(() => {});
    const md = await db.collection('draftTokenMetadata').doc(cardId).get();
    if (md.exists) await md.ref.set({ ...md.data(), LeagueId: '', LeagueDisplayName: '', DraftType: '' }, { merge: true });
  }
  return { healed: true };
}

// Complete an interrupted JOIN: write the missing in-use copies from the (already
// league-bound) token doc. Mirrors models/draft-token.go updateInUseDraftTokenInDatabase.
async function healSeatNoToken(wallet, cardId, leagueId) {
  const tok = (await db.collection('draftTokens').doc(cardId).get()).data();
  if (!tok || lc(tok.OwnerId) !== wallet || tok.LeagueId !== leagueId) return { skipped: 'token-not-bound-here' };
  if (APPLY) {
    await db.collection(`owners/${wallet}/usedDraftTokens`).doc(cardId).set(tok);
    await db.collection(`drafts/${leagueId}/cards`).doc(cardId).set(tok);
  }
  return { healed: true };
}

async function main() {
  console.log(`\n=== unstick-drafts — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (report only)'}${walletArg ? ` — wallet ${walletArg}` : ''} ===\n`);

  // ---- Type A: orphaned tokens (bound to a league, owner not in its roster) ----
  const used = await db.collectionGroup('usedDraftTokens').get();
  const rosterCache = new Map();
  const getRoster = async (L) => {
    if (!rosterCache.has(L)) {
      const doc = await db.collection('drafts').doc(L).get();
      rosterCache.set(L, doc.exists ? (doc.data().CurrentUsers || []) : null);
    }
    return rosterCache.get(L);
  };

  const orphans = [];
  for (const d of used.docs) {
    const t = d.data();
    const L = t.LeagueId;
    if (!L) continue;
    const owner = lc(d.ref.parent.parent.id);
    if (walletArg && owner !== walletArg) continue;
    const roster = await getRoster(L);
    if (roster === null) continue; // league doc gone — ambiguous, report separately below
    const seated = roster.some((u) => lc(u.OwnerId) === owner && String(u.TokenId) === d.id);
    if (!seated) orphans.push({ owner, cardId: d.id, league: L });
  }

  // ---- Type B: seated but token records missing (only filling/started drafts) ----
  const seatNoToken = [];
  const draftsSnap = walletArg
    ? await db.collection('drafts').get()
    : await db.collection('drafts').get();
  for (const doc of draftsSnap.docs) {
    // Skip synthetic/test drafts (ids like "_concurrency_test_…") — real season
    // drafts are "2026-fast-draft-N" / "2026-slow-draft-N" / special ids.
    if (doc.id.startsWith('_') || doc.id.includes('test')) continue;
    const d = doc.data();
    const roster = d.CurrentUsers || [];
    // Only FILLING lobbies (numPlayers < 10). A full/completed draft's roster is
    // history — its cards are legitimately re-used in later drafts, so a missing
    // token record there is NOT a broken join (false positive). See the reconcile
    // cron for the full rationale.
    if ((d.NumPlayers ?? roster.length) >= 10) continue;
    for (const u of roster) {
      const owner = lc(u.OwnerId);
      if (walletArg && owner !== walletArg) continue;
      const cardId = String(u.TokenId ?? '');
      // Skip malformed roster entries (missing/invalid token id) — not a real seat.
      if (!cardId || cardId === 'undefined' || !/^\d+$/.test(cardId)) continue;
      const usedDoc = await db.collection(`owners/${owner}/usedDraftTokens`).doc(cardId).get();
      if (usedDoc.exists) continue;
      // Confirm the token still points at THIS draft (real half-finished join),
      // not a card that has moved on to a later draft.
      const tok = (await db.collection('draftTokens').doc(cardId).get()).data();
      if (tok && lc(tok.OwnerId) === owner && tok.LeagueId === doc.id) {
        seatNoToken.push({ owner, cardId, league: doc.id });
      }
    }
  }

  console.log(`Type A — orphaned tokens (stuck IN a draft): ${orphans.length}`);
  for (const o of orphans) console.log(`   ${o.owner.slice(0, 12)}… token ${o.cardId} bound to ${o.league} but not seated`);
  console.log(`Type B — seated but no token record (invisible draft): ${seatNoToken.length}`);
  for (const s of seatNoToken) console.log(`   ${s.owner.slice(0, 12)}… seated in ${s.league} token ${s.cardId} but no usedDraftTokens record`);

  if (!APPLY) {
    console.log(`\n(dry run — nothing written. Re-run with --apply to heal.)\n`);
    await rtdb.goOffline();
    return;
  }

  const affected = new Set();
  for (const o of orphans) { const r = await healOrphan(o.owner, o.cardId, o.league); if (r.healed) { affected.add(o.owner); console.log(`healed A: ${o.cardId} returned to ${o.owner.slice(0, 12)}…`); } }
  for (const s of seatNoToken) { const r = await healSeatNoToken(s.owner, s.cardId, s.league); if (r.healed) { affected.add(s.owner); console.log(`healed B: ${s.cardId} records written for ${s.owner.slice(0, 12)}…`); } }
  for (const w of affected) { const c = await mirrorCounters(w); console.log(`counters ${w.slice(0, 12)}… -> paid ${c.paid} / free ${c.free}`); }
  console.log(`\nDone. Healed ${affected.size} wallet(s).\n`);
  await rtdb.goOffline();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
