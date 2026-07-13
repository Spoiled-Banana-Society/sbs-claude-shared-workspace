import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
const saJson = JSON.parse(fs.readFileSync('/Users/borisvagner/.gcp/sbs-staging-env-key.json', 'utf-8'));
initializeApp({ credential: cert(saJson) });
const db = getFirestore();

for (const W of ['0x6718ab0fea9ca0334d97198d5a6d61e4df7e2608', '0x438bbe98eed1dd2df244b007dab0583cc9be72e0']) {
  const p = await db.collection('v2_users').doc(W).collection('promos').doc('1').get();
  const d = p.exists ? p.data() : null;
  console.log(W.slice(0,8), 'daily promo:', d ? JSON.stringify({
    progress: `${d.progressCurrent}/${d.progressMax}`,
    timerEndTime: d.timerEndTime ?? null,
    claimable: d.claimable, claimCount: d.claimCount,
    completedDraftIds: d.completedDraftIds ?? [],
    updatedAt: d.updatedAt ?? null,
  }) : 'NO DOC');
}
