import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const w = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';

// Which draft docs actually exist
for (const id of ['2024-fast-draft-819','2024-fast-draft-820','2024-fast-draft-821']) {
  const dd = await fs.collection('drafts').doc(id).get();
  console.log(`draft doc ${id}: exists=${dd.exists}${dd.exists?` DisplayName="${dd.data().DisplayName}"`:''}`);
}

// admin wallet used tokens for recent leagues
const used = await fs.collection('owners').doc(w).collection('usedDraftTokens').get();
console.log(`\nAdmin wallet usedDraftTokens stamped to 819/820/821:`);
for (const d of used.docs) {
  const x = d.data() || {};
  const lid = String(x.LeagueId||'');
  if (/2024-fast-draft-(819|820|821)$/.test(lid)) {
    console.log(`  docId=${d.id}  CardId=${x.CardId}  LeagueId=${lid}  DisplayName="${x.LeagueDisplayName}"  Level=${x.Level}`);
  }
}

// CurrentUsers of the real draft 820 — admin's legit TokenId
const dd = await fs.collection('drafts').doc('2024-fast-draft-820').get();
const cu = (dd.data()||{}).CurrentUsers || [];
const mine = cu.find(u => String(u.OwnerId||'').toLowerCase() === w);
console.log(`\nAdmin's legit slot in real draft 820: TokenId=${mine?.TokenId}`);
process.exit(0);
