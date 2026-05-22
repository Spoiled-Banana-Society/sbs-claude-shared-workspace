import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const fs = admin.firestore();
const rtdb = admin.database();

// draftTracker
const t = await fs.collection('drafts').doc('draftTracker').get();
console.log('draftTracker:', JSON.stringify(t.data()));

// active 2024 drafts in Firestore
const ds = await fs.collection('drafts').get();
const active = ds.docs.filter(d => /^2024-(fast|slow)-draft-\d+$/.test(d.id)).map(d => d.id);
console.log('\nFirestore 2024-fast/slow drafts:', active.join(', ') || '(none)');

// RTDB drafts
const r = await rtdb.ref('drafts').once('value');
const rk = r.exists() ? Object.keys(r.val() || {}) : [];
console.log('RTDB drafts/ node:', rk.join(', ') || '(empty)');

// Boris real Privy used tokens — which leagues
const w = '0xd3301bc039faf4223da98bceb5fb81abc9399362';
const used = await fs.collection('owners').doc(w).collection('usedDraftTokens').get();
console.log(`\nBoris real Privy usedDraftTokens (${used.size}):`);
for (const d of used.docs) {
  const x = d.data() || {};
  console.log(`  card=${d.id}  LeagueId=${x.LeagueId}  DisplayName=${x.LeagueDisplayName}  Level=${x.Level}`);
}
const valid = await fs.collection('owners').doc(w).collection('validDraftTokens').get();
console.log(`Boris real Privy validDraftTokens: ${valid.size}`);
process.exit(0);
