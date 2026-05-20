import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const w = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const KEEP_LEAGUE = '2024-fast-draft-821'; // the real current 1/10 draft

const rosterCount = (r) => !r ? 0 :
  (r.QB?.length||0)+(r.RB?.length||0)+(r.WR?.length||0)+(r.TE?.length||0)+(r.DST?.length||0);

const ownerRef = fs.collection('owners').doc(w);
const usedCol = ownerRef.collection('usedDraftTokens');
const validCol = ownerRef.collection('validDraftTokens');
const used = await usedCol.get();

let unstamped = 0, keptCurrent = 0, keptCompleted = 0;
let batch = fs.batch(), ops = 0;

for (const doc of used.docs) {
  const t = doc.data() || {};
  const lid = String(t.LeagueId || '');
  const rc = rosterCount(t.Roster);

  if (lid === KEEP_LEAGUE) { keptCurrent++; continue; }
  if (rc >= 15) { keptCompleted++; continue; }            // completed — keeps standings history, won't clutter My Drafts

  // non-completed leftover from the bug -> un-stamp back to valid passes
  const cardId = t.CardId || doc.id;
  batch.set(validCol.doc(cardId), {
    ImageUrl: t.ImageUrl || 'https://storage.googleapis.com/sbs-draft-token-images/thumbnails/draft-token-image-default_350x490.png',
    DraftType: '', OwnerId: w, LeagueId: '', WeekScore: '0', SeasonScore: '0',
    Playoffs: false, Level: t.Level || 'Pro', LeagueDisplayName: '', LeagueRank: '',
    Roster: { DST: [], QB: [], RB: [], TE: [], WR: [] }, Rank: 'N/A', Prizes: { ETH: 0 },
    CardId: cardId,
  });
  batch.delete(doc.ref);
  ops += 2; unstamped++;
  if (ops >= 400) { await batch.commit(); batch = fs.batch(); ops = 0; }
}
if (ops > 0) await batch.commit();

const usedAfter = await usedCol.get();
const validAfter = await validCol.get();
console.log(`Un-stamped (cleared from My Drafts): ${unstamped}`);
console.log(`Kept current 1/10 draft token: ${keptCurrent}`);
console.log(`Kept completed-draft tokens (standings history): ${keptCompleted}`);
console.log(`\nNow: usedDraftTokens=${usedAfter.size}, validDraftTokens=${validAfter.size}`);
// what will still show in My Drafts (non-completed used tokens)
const stillActive = usedAfter.docs.filter(d => rosterCount(d.data()?.Roster) < 15)
  .map(d => d.data()?.LeagueId);
console.log(`My Drafts will now show (non-completed): ${JSON.stringify(stillActive)}`);
process.exit(0);
