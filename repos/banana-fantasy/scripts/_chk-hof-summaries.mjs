import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
for (const league of ['2025-slow-draft-3', '2025-slow-draft-5']) {
  const doc = await db.collection('drafts').doc(league).collection('state').doc('summary').get();
  const rows = (doc.data()?.Summary ?? []);
  const byOwner = {};
  for (const r of rows) {
    const o = (r?.PlayerInfo?.OwnerAddress || '').toLowerCase();
    if (!o || !r?.PlayerInfo?.PlayerId) continue;
    byOwner[o] = (byOwner[o] || 0) + 1;
  }
  const counts = Object.values(byOwner);
  console.log(`${league}: rows=${rows.length} owners=${counts.length} perOwner=[${counts.join(',')}]`);
}
process.exit(0);
