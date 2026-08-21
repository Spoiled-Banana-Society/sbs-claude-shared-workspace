// VOID 2026-slow-draft-40 (BBB #419) and refund every seat EXCEPT Cherry
// (0xed3edfd8398dffe345590c4884a02de666559bb0) — Richard 8/16 (troll drafting wrecked ADP).
// Mirrors app/api/admin/drafts/manage/[slotId] DELETE exactly, minus cherry's
// refund. cherry's token stays in usedDraftTokens (pass consumed) but its league
// stamp is cleared so nothing references the deleted draft.
// Tracker (FilledLeaguesCount) is NOT touched: #725 (fast-draft-640) already filled after this,
// so #724 becomes dead-but-counted (same treatment as BBB #133).
// Usage: node scripts/_void-draft-639-refund-except-cherry.mjs        (dry run)
//        CONFIRM=1 node scripts/_void-draft-639-refund-except-cherry.mjs
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';

const DRY = process.env.CONFIRM !== '1';
const ID = '2026-slow-draft-40';
const KEEP_BURNED = '0xed3edfd8398dffe345590c4884a02de666559bb0'; // Cherry — NO refund
const LEAGUE_LABEL = 'League #419';
const EXPECTED_MEMBERS = 10;

const envText = readFileSync('/Users/richardvagner/banana-fantasy/.env.production', 'utf8');
const sa = JSON.parse(Buffer.from(envText.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1], 'base64').toString('utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = getFirestore();
const rtdb = getDatabase();
const lc = (s) => String(s || '').toLowerCase();
// Wipe the voided draft's 15-player roster off every token copy, else the
// drafting page hides the user's NEXT draft row (rosterCount>=15 => completed).
const RESET = { Roster: { QB: null, RB: null, WR: null, TE: null, DST: null }, Rank: 'N/A', WeekScore: '0', SeasonScore: '0', LeagueRank: '', Prizes: { ETH: 0 } };
const CLEAR = { LeagueId: '', DraftType: '', LeagueDisplayName: '', ...RESET };

const draftSnap = await db.doc(`drafts/${ID}`).get();
if (!draftSnap.exists) { console.log('draft doc missing — abort'); process.exit(1); }
const draft = draftSnap.data();
if (draft.DisplayName !== 'BBB #419') { console.log('DisplayName mismatch:', draft.DisplayName, '— abort'); process.exit(1); }
const members = draft.CurrentUsers || [];
if (members.length !== EXPECTED_MEMBERS) { console.log('unexpected member count', members.length, '— abort'); process.exit(1); }
const info = (await db.doc(`drafts/${ID}/state/info`).get()).data();
if (!info || info.CurrentPickNumber !== 150) { console.log('draft not at pick 150 — abort'); process.exit(1); }
const cards = await db.collection(`drafts/${ID}/cards`).get();
console.log(`${DRY ? 'DRY RUN' : 'EXECUTING'} — ${ID} (${draft.DisplayName}) members=${members.length} cards=${cards.size}`);

const results = [];
for (const { OwnerId, TokenId } of members) {
  const owner = lc(OwnerId), tokenId = String(TokenId);
  const usedRef = db.doc(`owners/${owner}/usedDraftTokens/${tokenId}`);
  const usedSnap = await usedRef.get();
  const cardSnap = await db.doc(`drafts/${ID}/cards/${tokenId}`).get();
  const tokSnap = await db.doc(`draftTokens/${tokenId}`).get();
  const tok = tokSnap.data() || {};
  const src = usedSnap.exists ? usedSnap.data() : cardSnap.data();
  const user = (await db.doc(`v2_users/${owner}`).get()).data() || {};
  const line = `${owner} token=${tokenId} (${user.username || '?'}) PassType=${src?.PassType} stamp=${tok.LeagueId} usedDoc=${usedSnap.exists} card=${cardSnap.exists}`;
  if (tok.LeagueId !== ID) { console.log('⛔ SKIP (not stamped to this draft):', line); results.push({ owner, tokenId, action: 'skip-stamp' }); continue; }
  if (lc(tok.OwnerId) !== owner) { console.log('⛔ SKIP (owner mismatch):', line); results.push({ owner, tokenId, action: 'skip-owner' }); continue; }
  const alreadyValid = (await db.doc(`owners/${owner}/validDraftTokens/${tokenId}`).get()).exists;

  if (owner === KEEP_BURNED) {
    console.log('🔥 BURN (no refund, clear stamp only):', line);
    results.push({ owner, tokenId, action: 'burn' });
    if (DRY) continue;
    const batch = db.batch();
    batch.set(db.doc(`draftTokens/${tokenId}`), CLEAR, { merge: true });
    if (usedSnap.exists) batch.set(usedRef, CLEAR, { merge: true });
    await batch.commit();
    continue;
  }

  if (alreadyValid) { console.log('⚠️ already in validDraftTokens — SKIP restore:', line); results.push({ owner, tokenId, action: 'skip-already-valid' }); continue; }
  console.log('✅ REFUND:', line);
  results.push({ owner, tokenId, action: 'refund', passType: src?.PassType });
  if (DRY) continue;
  const cleared = { ...src, ...CLEAR };
  const batch = db.batch();
  batch.set(db.doc(`draftTokens/${tokenId}`), CLEAR, { merge: true });
  batch.set(db.doc(`owners/${owner}/validDraftTokens/${tokenId}`), cleared);
  batch.delete(usedRef);
  await batch.commit();
  // metadata LEAGUE-NAME trait → '' (Go RemoveTokenFromLeague parity)
  const mdRef = db.doc(`draftTokenMetadata/${tokenId}`);
  const md = await mdRef.get();
  if (md.exists) {
    const attrs = (md.data().Attributes || []).map((a) =>
      String(a.Trait_Type || a.trait_type || '').toUpperCase() === 'LEAGUE-NAME' ? { ...a, Value: '' } : a);
    await mdRef.update({ Attributes: attrs }).catch(() => {});
  }
  // bell (dedupe id identical to createNotification's)
  const dedupeKey = `pass-refund-${ID}-${tokenId}`;
  const docId = `${owner}__${dedupeKey}`.replace(/[/\\\s]+/g, '_').slice(0, 1400);
  const bell = { wallet: owner, type: 'system', title: 'Draft pass refunded',
    message: `Your draft pass for ${LEAGUE_LABEL} was refunded. It's back in your account.`,
    link: null, read: false, dedupeKey, icon: '💸', createdAt: FieldValue.serverTimestamp() };
  try { await db.collection('marketplace_notifications').doc(docId).create(bell); } catch (e) { if (!/already exists/i.test(String(e)) && e.code !== 6) throw e; }
  await rtdb.ref(`userEvents/${owner}`).push({ type: 'notification', timestamp: Date.now(), source: 'createNotification', notifId: docId, notifType: 'system', notifTitle: bell.title, notifMessage: bell.message, notifLink: '', notifIcon: '💸' });
  // mirror pass counters from real inventory (passLedger.recountFromInventory parity)
  const valid = await db.collection(`owners/${owner}/validDraftTokens`).get();
  let paid = 0, free = 0;
  valid.forEach((d) => { const x = d.data(); const lvl = String(x.Level ?? x.level ?? '').trim(); if (['Hall of Fame','Jackpot','JackHOF'].includes(lvl)) return; (String(x.PassType ?? x.passType ?? '').toLowerCase() === 'free') ? free++ : paid++; });
  await db.doc(`v2_users/${owner}`).set({ draftPasses: paid, freeDrafts: free, walletAddress: owner, passesSyncedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`   counters → paid=${paid} free=${free}`);
}

if (!DRY) {
  await db.recursiveDelete(db.doc(`drafts/${ID}`));
  await rtdb.ref(`drafts/${ID}`).remove();
  console.log('deleted drafts/' + ID + ' (recursive) + RTDB node');
}

console.log('\n--- verify ---');
for (const { OwnerId, TokenId } of members) {
  const owner = lc(OwnerId), tokenId = String(TokenId);
  const v = await db.doc(`owners/${owner}/validDraftTokens/${tokenId}`).get();
  const u = await db.doc(`owners/${owner}/usedDraftTokens/${tokenId}`).get();
  const t = await db.doc(`draftTokens/${tokenId}`).get();
  const usr = (await db.doc(`v2_users/${owner}`).get()).data() || {};
  const rc = (d) => Object.values((d && d.Roster) || {}).reduce((a, x) => a + ((x || []).length), 0);
  console.log(`${owner.slice(0,10)} ${tokenId}: valid=${v.exists} used=${u.exists} stamp="${t.data()?.LeagueId}" type=${t.data()?.PassType} roster tok=${rc(t.data())} valid=${rc(v.data())} used=${rc(u.data())} | user paid=${usr.draftPasses} free=${usr.freeDrafts}`);
}
console.log('draft doc exists:', (await db.doc(`drafts/${ID}`).get()).exists, '| rtdb node:', (await rtdb.ref(`drafts/${ID}`).once('value')).exists());
console.log(JSON.stringify(results));
process.exit(0);
