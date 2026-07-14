// Restore all 10 passes consumed by frozen 2026-fast-draft-128.
// Mirrors Go models.DraftToken.RemoveTokenFromLeague() exactly:
//   1. draftTokens/{id}: LeagueId/DraftType/LeagueDisplayName -> ""
//   2. owners/{owner}/validDraftTokens/{id} <- restored token doc
//   3. delete owners/{owner}/usedDraftTokens/{id}
//   4. delete drafts/<league>/cards/{id}
//   5. draftTokenMetadata/{id}: LEAGUE-NAME trait -> ""
// Guard: only touches a token whose draftTokens doc is stamped to draft-128.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry');
const LEAGUE = '2026-fast-draft-128';
const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))) });
const db = admin.firestore();

const league = (await db.collection('drafts').doc(LEAGUE).get()).data();
const members = league.CurrentUsers; // [{OwnerId, TokenId}]
console.log((DRY ? 'DRY RUN — ' : '') + 'restoring passes for', members.length, 'members of', LEAGUE);

for (const { OwnerId: owner, TokenId: tokenId } of members) {
  const ref = db.collection('draftTokens').doc(tokenId);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`⛔ ${tokenId} (${owner.slice(0, 10)}): no draftTokens doc — SKIP`); continue; }
  const tok = snap.data();
  if (tok.LeagueId !== LEAGUE) { console.log(`⛔ ${tokenId}: stamped to "${tok.LeagueId}" not ${LEAGUE} — SKIP`); continue; }
  if (String(tok.OwnerId).toLowerCase() !== owner.toLowerCase()) { console.log(`⛔ ${tokenId}: owner mismatch ${tok.OwnerId} vs ${owner} — SKIP`); continue; }
  const already = await db.doc(`owners/${owner}/validDraftTokens/${tokenId}`).get();
  if (already.exists) { console.log(`⚠️ ${tokenId}: already in validDraftTokens — SKIP`); continue; }

  const restored = { ...tok, LeagueId: '', DraftType: '', LeagueDisplayName: '' };
  console.log(`✅ ${tokenId} (${owner.slice(0, 10)}) PassType=${tok.PassType}${DRY ? ' [dry]' : ''}`);
  if (DRY) continue;

  await ref.set(restored);
  await db.doc(`owners/${owner}/validDraftTokens/${tokenId}`).set(restored);
  await db.doc(`owners/${owner}/usedDraftTokens/${tokenId}`).delete();
  await db.doc(`drafts/${LEAGUE}/cards/${tokenId}`).delete();
  const mdRef = db.collection('draftTokenMetadata').doc(tokenId);
  const md = await mdRef.get();
  if (md.exists) {
    const attrs = (md.data().Attributes || []).map(a =>
      String(a.Trait_Type || a.trait_type).toUpperCase() === 'LEAGUE-NAME' ? { ...a, Value: '' } : a);
    await mdRef.update({ Attributes: attrs });
  }
}

// verify
console.log('\n--- verify ---');
for (const { OwnerId: owner, TokenId: tokenId } of members) {
  const v = await db.doc(`owners/${owner}/validDraftTokens/${tokenId}`).get();
  const u = await db.doc(`owners/${owner}/usedDraftTokens/${tokenId}`).get();
  const t = await db.doc(`draftTokens/${tokenId}`).get();
  console.log(`${tokenId} ${owner.slice(0, 10)}: valid=${v.exists} used=${u.exists} stamp="${t.exists ? t.data().LeagueId : '?'}" type=${t.exists ? t.data().PassType : '?'}`);
}
process.exit(0);
