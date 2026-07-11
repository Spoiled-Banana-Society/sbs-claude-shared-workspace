#!/usr/bin/env node
// Find active slow drafts and dump their realtime state + sortOrders
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const FE = '/Users/richardvagner/sbs-claude-shared-workspace/repos/banana-fantasy';
const src = readFileSync(FE + '/lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();

const snap = await db.collection('drafts').where('draftType', '==', 'slow').get();
console.log('slow drafts total:', snap.size);
for (const doc of snap.docs) {
  const d = doc.data();
  // Skip completed ones
  const rt = await db.doc(`drafts/${doc.id}/state/realTimeDraftInfo`).get().catch(() => null);
  const rtd = rt && rt.exists ? rt.data() : null;
  if (rtd && rtd.isDraftComplete) continue;
  console.log('\n=== draft', doc.id, '| name:', d.displayName || d.name, '| status:', d.status, '| pickLength:', d.pickLength);
  if (rtd) {
    console.log('  rt: pickNumber=', rtd.pickNumber, 'round=', rtd.roundNum, 'currentDrafter=', rtd.currentDrafter,
      'pickStart=', rtd.pickStartTime && new Date(rtd.pickStartTime * 1000).toISOString(),
      'pickEnd=', rtd.pickEndTime && new Date(rtd.pickEndTime * 1000).toISOString(),
      'complete=', rtd.isDraftComplete);
  } else {
    console.log('  (no realTimeDraftInfo)');
  }
  const order = (d.draftOrder || []).map(u => u.ownerId || u.OwnerId);
  console.log('  order:', order.join(', '));
}
process.exit(0);
