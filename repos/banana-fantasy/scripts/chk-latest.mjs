import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

const t = await fs.collection('drafts').doc('draftTracker').get();
console.log('draftTracker:', JSON.stringify(t.data()));

const ds = await fs.collection('drafts').get();
const active = ds.docs.filter(d => /^2024-(fast|slow)-draft-\d+$/.test(d.id))
  .map(d => ({ id: d.id, dn: d.data().DisplayName, np: d.data().NumPlayers }));
console.log('\n2024 draft docs:', JSON.stringify(active));

const w = '0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const used = await fs.collection('owners').doc(w).collection('usedDraftTokens').get();
const recent = used.docs.map(d => ({ card: d.id, lid: d.data().LeagueId, dn: d.data().LeagueDisplayName }))
  .filter(x => /2024-fast-draft-(81[5-9]|82\d|83\d)$/.test(String(x.lid)));
console.log('\nAdmin wallet usedDraftTokens for recent drafts (815+):', JSON.stringify(recent, null, 1));
console.log('Admin total usedDraftTokens:', used.size);
process.exit(0);
