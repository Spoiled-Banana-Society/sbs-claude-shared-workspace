/**
 * Moves a wallet's usedDraftTokens that are stamped to a draft no longer
 * present in Firestore back into validDraftTokens (un-stamped, reusable).
 * Run: SA_PATH=/tmp/sa-staging.json node scripts/free-orphaned-tokens.mjs <wallet>
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const wallet = (process.argv[2] || '').toLowerCase();
if (!wallet) { console.error('usage: node free-orphaned-tokens.mjs <wallet>'); process.exit(1); }

// Live draft ids still in Firestore
const draftsSnap = await fs.collection('drafts').get();
const liveDraftIds = new Set(draftsSnap.docs.map(d => d.id));

const ownerRef = fs.collection('owners').doc(wallet);
const usedCol = ownerRef.collection('usedDraftTokens');
const validCol = ownerRef.collection('validDraftTokens');
const used = await usedCol.get();

let moved = 0, kept = 0;
let batch = fs.batch(), ops = 0;
for (const doc of used.docs) {
  const t = doc.data() || {};
  const lid = String(t.LeagueId || '');
  // orphaned if it points to a draft that no longer exists (or no league at all)
  if (lid && liveDraftIds.has(lid)) { kept++; continue; }

  const cardId = t.CardId || doc.id;
  const freed = {
    ImageUrl: t.ImageUrl || 'https://storage.googleapis.com/sbs-draft-token-images/thumbnails/draft-token-image-default_350x490.png',
    DraftType: '',
    OwnerId: wallet,
    LeagueId: '',
    WeekScore: '0',
    SeasonScore: '0',
    Playoffs: false,
    Level: t.Level || 'Pro',
    LeagueDisplayName: '',
    LeagueRank: '',
    Roster: { DST: [], QB: [], RB: [], TE: [], WR: [] },
    Rank: 'N/A',
    Prizes: { ETH: 0 },
    CardId: cardId,
  };
  batch.set(validCol.doc(cardId), freed);
  batch.delete(doc.ref);
  ops += 2; moved++;
  if (ops >= 400) { await batch.commit(); batch = fs.batch(); ops = 0; }
}
if (ops > 0) await batch.commit();

const validAfter = await validCol.get();
const usedAfter = await usedCol.get();
console.log(`Wallet ${wallet}`);
console.log(`  Moved ${moved} orphaned used tokens -> validDraftTokens (un-stamped)`);
console.log(`  Kept ${kept} used tokens that point to a live draft`);
console.log(`  Now: validDraftTokens=${validAfter.size}, usedDraftTokens=${usedAfter.size}`);
process.exit(0);
