import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();
const wallets = {
  'Boris real Privy': '0xd3301bC039faF4223dA98bcEB5Fb81aBC9399362',
  'Boris MOCK':       '0xd3301bC039faF4223dA98bcEB5Fb818C9993620',
};
for (const [name, w] of Object.entries(wallets)) {
  const lc = w.toLowerCase();
  // v2_users — try a few id casings
  for (const id of [w, lc]) {
    const u = await fs.collection('v2_users').doc(id).get();
    if (u.exists) {
      const d = u.data() || {};
      console.log(`\n${name}  v2_users/${id}`);
      console.log(`  draftPasses=${d.draftPasses}  freeDrafts=${d.freeDrafts}  jackpotEntries=${d.jackpotEntries}  hofEntries=${d.hofEntries}  wheelSpins=${d.wheelSpins}  cardPurchaseCount=${d.cardPurchaseCount}`);
    }
  }
  const valid = await fs.collection('owners').doc(lc).collection('validDraftTokens').get();
  console.log(`  (Go-engine owners/${lc}/validDraftTokens = ${valid.size})`);
}
process.exit(0);
