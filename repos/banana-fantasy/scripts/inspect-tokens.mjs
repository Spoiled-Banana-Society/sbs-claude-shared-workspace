import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const fs = admin.firestore();
const rtdb = admin.database();

// RTDB drafts node
const rtdbSnap = await rtdb.ref('drafts').once('value');
const rtdbKeys = rtdbSnap.exists() ? Object.keys(rtdbSnap.val() || {}) : [];
console.log(`=== RTDB drafts/ node: ${rtdbKeys.length} entries ===`);
console.log(rtdbKeys.slice(0, 40).join(', ') + (rtdbKeys.length > 40 ? ` ...(+${rtdbKeys.length-40})` : ''));

// Live 2024-* draft docs
const draftsSnap = await fs.collection('drafts').get();
const live2024 = draftsSnap.docs.filter(d => /^2024-(fast|slow)-draft-\d+$/.test(d.id)).map(d=>d.id);
console.log(`\n=== Firestore 2024-fast/slow-draft docs: ${live2024.length} ===`);
console.log(live2024.join(', ') || '(none)');

// Token state for real test wallets
const wallets = {
  'Boris': '0xd3301bC039faF4223dA98bcEB5Fb81aBC9399362',
  'Richard': '0x2e64Db49fc597a731091471607F6CD0251d7EAFb',
};
for (const [name, w] of Object.entries(wallets)) {
  const lc = w.toLowerCase();
  const valid = await fs.collection('owners').doc(lc).collection('validDraftTokens').get();
  const used = await fs.collection('owners').doc(lc).collection('usedDraftTokens').get();
  let orphaned = 0;
  const usedRefs = {};
  for (const d of used.docs) {
    const lid = String(d.data()?.LeagueId || '');
    usedRefs[lid] = (usedRefs[lid] || 0) + 1;
    if (lid && !live2024.includes(lid)) orphaned++;
  }
  console.log(`\n=== ${name} (${lc}) ===`);
  console.log(`  validDraftTokens: ${valid.size}`);
  console.log(`  usedDraftTokens:  ${used.size}  (orphaned -> deleted draft: ${orphaned})`);
  console.log(`  used token LeagueId breakdown:`, JSON.stringify(usedRefs));
}
process.exit(0);
