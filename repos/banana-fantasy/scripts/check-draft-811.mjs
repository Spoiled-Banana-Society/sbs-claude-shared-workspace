import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const fs = admin.firestore();

const draftId = '2024-fast-draft-811';
const doc = await fs.collection('drafts').doc(draftId).get();
if (doc.exists) {
  const d = doc.data();
  console.log(`=== Firestore drafts/${draftId} ===`);
  console.log('DisplayName:', d.DisplayName);
  console.log('CurrentUsers:', (d.CurrentUsers || []).slice(0, 12).map(u => ({ owner: u.OwnerId, name: u.OwnerName, slot: u.SlotIndex })));
}

// Find Boris's wallet across all known wallet patterns
const wallets = [
  '0xd3301bC039faF4223dA98bcEB5Fb81aBC9399362',
  '0xd3301bC039faF4223dA98bcEB5Fb818C9993620',
];
for (const w of wallets) {
  const ww = w.toLowerCase();
  console.log(`\n=== Tokens for ${w} ===`);
  const tokSnap = await fs.collection('v2_users').doc(ww).get();
  if (!tokSnap.exists) { console.log('  no user doc'); continue; }
  // Look for any token referencing 811
  const tokens = await fs.collection('v2_users').doc(ww).collection('draftTokens')
    .where('LeagueId', '==', draftId).get();
  console.log(`  tokens for ${draftId}:`, tokens.size);
  tokens.forEach(t => {
    const data = t.data();
    console.log(`    CardId=${data.CardId || data.cardId}  LeagueDisplayName="${data.LeagueDisplayName || data.leagueDisplayName}"  LeagueId=${data.LeagueId}`);
  });
}
process.exit(0);
