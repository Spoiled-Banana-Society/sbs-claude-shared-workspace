import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync(process.env.HOME + '/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();
const snap = await db.collection('v2_activity_events').where('type', '==', 'pass_purchased').get();
let pre = 0, preUsd = 0;
for (const d of snap.docs) {
  const e = d.data();
  if (e.paymentMethod !== 'usdc' && e.paymentMethod !== 'card') continue;
  if ((e.createdAtIso ?? '') < '2026-06-22') {
    pre++; preUsd += (Number(e.quantity) || 0) * 25;
    console.log(`${e.createdAtIso?.slice(0, 16)} ${e.walletAddress?.slice(0, 12)} $${(Number(e.quantity) || 0) * 25} ${e.paymentMethod}`);
  }
}
console.log(`\npre-launch paid events: ${pre}, $${preUsd}`);
