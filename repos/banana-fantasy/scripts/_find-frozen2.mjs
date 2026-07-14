// Scan RTDB drafts/*/realTimeDraftInfo for frozen (non-complete, expired clock)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const src = readFileSync('lib/firebaseAdmin.ts', 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});
const db = admin.firestore();
const rtdb = admin.database();
const now = Date.now() / 1000;

const bots = await db.collection('botWallets').get();
const botSet = new Set(bots.docs.map(d => (d.data().wallet || d.id).toLowerCase()));

const root = await rtdb.ref('drafts').once('value');
const all = root.val() || {};
console.log('RTDB draft nodes:', Object.keys(all).length);
for (const [id, node] of Object.entries(all)) {
  const rtd = node.realTimeDraftInfo;
  if (!rtd) continue;
  if (rtd.isDraftComplete) continue;
  const end = rtd.pickEndTime;
  const ageMin = end ? Math.round((now - end) / 60) : null;
  const cur = String(rtd.currentDrafter || '').toLowerCase();
  console.log(`\n🟡 NON-COMPLETE: ${id}`);
  console.log('  pick', rtd.pickNumber, 'round', rtd.roundNum ?? rtd.round, '| currentDrafter:', rtd.currentDrafter, botSet.has(cur) ? '[BOT]' : '');
  console.log('  pickStart:', rtd.pickStartTime && new Date(rtd.pickStartTime * 1000).toISOString(),
    '| pickEnd:', end && new Date(end * 1000).toISOString(), end ? `(expired ${ageMin} min ago)` : '');
  console.log('  keys:', Object.keys(rtd).join(','));
  console.log('  numPlayers:', node.numPlayers, '| other node keys:', Object.keys(node).join(','));
}
process.exit(0);
