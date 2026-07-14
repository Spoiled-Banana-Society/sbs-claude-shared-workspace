// Find frozen drafts: non-complete, pick clock expired
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
const now = Date.now() / 1000;

// bot registry
const bots = await db.collection('botWallets').get();
const botSet = new Set(bots.docs.map(d => (d.data().wallet || d.id).toLowerCase()));
console.log('bot registry:', bots.size, 'bots:', [...botSet].join(', '));

const snap = await db.collection('drafts').get();
console.log('total draft docs:', snap.size);
for (const doc of snap.docs) {
  const d = doc.data();
  const rt = await db.doc(`drafts/${doc.id}/state/realTimeDraftInfo`).get().catch(() => null);
  const rtd = rt && rt.exists ? rt.data() : null;
  if (!rtd || rtd.isDraftComplete) continue;
  const end = rtd.pickEndTime;
  const stale = end && (now - end) > 90; // clock expired >90s ago
  if (!stale) {
    console.log('ACTIVE ok:', doc.id, 'pick', rtd.pickNumber, 'ends in', end ? Math.round(end - now) + 's' : '?');
    continue;
  }
  console.log('\n🧊 FROZEN?', doc.id, '| status:', d.status, '| type:', d.draftType || d.speed, '| pickLength:', d.pickLength);
  console.log('  pick', rtd.pickNumber, 'round', rtd.roundNum, 'currentDrafter:', rtd.currentDrafter,
    '| clock expired', Math.round((now - end) / 60), 'min ago',
    '| pickStart', rtd.pickStartTime && new Date(rtd.pickStartTime * 1000).toISOString());
  const cur = String(rtd.currentDrafter || '').toLowerCase();
  console.log('  currentDrafter is bot?', botSet.has(cur));
  const order = (d.draftOrder || []).map(u => {
    const w = String(u.ownerId || u.OwnerId || '').toLowerCase();
    return w + (botSet.has(w) ? ' [BOT]' : '');
  });
  console.log('  order:', order.join('\n         '));
}
process.exit(0);
