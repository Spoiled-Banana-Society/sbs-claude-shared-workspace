import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const w = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const KEEP = '1779229287154';                                  // real slot in 2024-fast-draft-820
const REMOVE = ['1779228376640', '1779228540387', '1779229162543']; // ghost + duplicates

const ownerRef = fs.collection('owners').doc(w);
const usedCol = ownerRef.collection('usedDraftTokens');
const validCol = ownerRef.collection('validDraftTokens');

for (const cardId of REMOVE) {
  const snap = await usedCol.doc(cardId).get();
  if (!snap.exists) { console.log(`  ${cardId}: not found (already gone)`); continue; }
  const t = snap.data() || {};
  // un-stamp -> validDraftTokens (returns the wrongly-spent pass)
  await validCol.doc(cardId).set({
    ImageUrl: t.ImageUrl || 'https://storage.googleapis.com/sbs-draft-token-images/thumbnails/draft-token-image-default_350x490.png',
    DraftType: '', OwnerId: w, LeagueId: '', WeekScore: '0', SeasonScore: '0',
    Playoffs: false, Level: t.Level || 'Pro', LeagueDisplayName: '', LeagueRank: '',
    Roster: { DST: [], QB: [], RB: [], TE: [], WR: [] }, Rank: 'N/A', Prizes: { ETH: 0 },
    CardId: cardId,
  });
  await usedCol.doc(cardId).delete();
  console.log(`  ${cardId} (was -> ${t.LeagueId}): un-stamped, moved to validDraftTokens`);
}

// verify
const keepSnap = await usedCol.doc(KEEP).get();
const used = await usedCol.get();
const stillBad = used.docs.filter(d => /2024-fast-draft-(819|820|821)$/.test(String(d.data()?.LeagueId)) && d.id !== KEEP);
console.log(`\nKept real token ${KEEP}: exists=${keepSnap.exists} LeagueId=${keepSnap.data()?.LeagueId}`);
console.log(`Remaining used tokens for drafts 819/820/821 other than the real one: ${stillBad.length} (should be 0)`);
console.log(`Total usedDraftTokens now: ${used.size}`);
process.exit(0);
