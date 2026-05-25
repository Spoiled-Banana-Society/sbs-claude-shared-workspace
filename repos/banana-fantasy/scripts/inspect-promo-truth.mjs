import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

// THREE possible sources of truth for promo claim counts:
//   1. v2_user_events.eventType=promo_claimed   (event log, may have gaps)
//   2. v2_activity_events.type=promo_claimed    (event log, may have gaps)
//   3. v2_users/{wallet}/promos/{promoId}.claimCount  (atomic counter on the doc)

console.log('=== SOURCE 1: v2_user_events.promo_claimed ===');
const ue = await db.collection('v2_user_events').where('eventType', '==', 'promo_claimed').limit(50000).get();
const byTypeUE = {};
for (const d of ue.docs) {
  const t = String(d.data().meta?.promoType ?? '?');
  byTypeUE[t] = (byTypeUE[t] ?? 0) + 1;
}
console.log('Total events:', ue.size);
console.log('By type:', byTypeUE);

console.log('\n=== SOURCE 2: v2_activity_events.promo_claimed ===');
const ae = await db.collection('v2_activity_events').where('type', '==', 'promo_claimed').limit(50000).get();
const byTypeAE = {};
for (const d of ae.docs) {
  const t = String(d.data().metadata?.promoType ?? '?');
  byTypeAE[t] = (byTypeAE[t] ?? 0) + 1;
}
console.log('Total events:', ae.size);
console.log('By type:', byTypeAE);

console.log('\n=== SOURCE 3: collectionGroup(promos) — sum of claimCount ===');
const pg = await db.collectionGroup('promos').limit(50000).get();
const byTypePG = {};         // sum of claimCount per type
const usersClaimedPG = {};   // distinct users with claimCount > 0 per type
const detailRows = [];       // per-doc detail for spot checks
for (const doc of pg.docs) {
  const data = doc.data();
  const t = String(data.type ?? '?');
  const cc = typeof data.claimCount === 'number' ? data.claimCount : 0;
  const userId = doc.ref.path.split('/')[1];
  if (!byTypePG[t]) byTypePG[t] = 0;
  if (!usersClaimedPG[t]) usersClaimedPG[t] = new Set();
  byTypePG[t] += cc;
  if (cc > 0) usersClaimedPG[t].add(userId);
  if (cc > 1) detailRows.push({ user: userId, type: t, claimCount: cc });
}
console.log('Total docs scanned:', pg.size);
console.log('Sum of claimCount per type:');
for (const [t, n] of Object.entries(byTypePG).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(22)} total claims=${String(n).padEnd(4)} distinct users=${usersClaimedPG[t].size}`);
}
console.log('\nDocs with claimCount > 1 (multi-claim promos):');
for (const r of detailRows.slice(0, 20)) {
  console.log(`  ${r.user}  type=${r.type}  count=${r.claimCount}`);
}
