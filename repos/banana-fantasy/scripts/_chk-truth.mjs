import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

for (const id of ['994','161','359']) {
  console.log(`\n===== on-chain token ${id} =====`);
  // draftTokenMetadata keyed by on-chain id?
  const m = await fs.collection('draftTokenMetadata').doc(id).get();
  console.log(`draftTokenMetadata.doc('${id}') exists=${m.exists}`, m.exists?JSON.stringify(Object.keys(m.data())):'');
  // Search usedDraftTokens (drafted) across owners by RealTokenId == id
  const used = await fs.collectionGroup('usedDraftTokens').where('RealTokenId','==',id).get();
  console.log(`usedDraftTokens RealTokenId==${id}: ${used.size}`);
  used.forEach(d=>console.log(`  owner=${d.ref.parent.parent.id} CardId=${d.data().CardId} Level=${d.data().Level} LeagueId=${d.data().LeagueId}`));
  // validDraftTokens (undrafted pass) by RealTokenId
  const valid = await fs.collectionGroup('validDraftTokens').where('RealTokenId','==',id).get();
  console.log(`validDraftTokens RealTokenId==${id}: ${valid.size}`);
  valid.forEach(d=>console.log(`  owner=${d.ref.parent.parent.id} CardId=${d.data().CardId} Level=${d.data().Level}`));
}
process.exit(0);
