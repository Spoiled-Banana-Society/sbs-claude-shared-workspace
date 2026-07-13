import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fs = admin.firestore();

// 1. The founder schedule singleton
const sched = await fs.collection('founderSchedule').doc('next').get();
console.log('=== founderSchedule/next ===');
console.log(sched.exists ? JSON.stringify(sched.data(), null, 2) : 'DOES NOT EXIST');

// 2. All founderDrafts docs (should be small)
console.log('\n=== founderDrafts collection ===');
const fd = await fs.collection('founderDrafts').get();
console.log(`count: ${fd.size}`);
fd.forEach(d => console.log(d.id, '→', JSON.stringify(d.data())));

// 3. Draft 104 info from Go API — try common id shapes
const API = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
for (const id of ['2024-fast-draft-104', '2024-slow-draft-104', '104']) {
  try {
    const r = await fetch(`${API}/draft/${id}/state/info`, { cache: 'no-store' });
    if (!r.ok) { console.log(`\n${id}: HTTP ${r.status}`); continue; }
    const d = await r.json();
    console.log(`\n=== ${id} ===`);
    console.log('leagueName:', d.leagueName ?? d.LeagueName);
    console.log('draftStartTime:', d.draftStartTime, d.draftStartTime ? new Date(d.draftStartTime * 1000).toISOString() : '');
    console.log('draftOrder owners:', (d.draftOrder ?? []).map(o => o.ownerId));
  } catch (e) { console.log(`\n${id}: ERR ${e.message}`); }
}
process.exit(0);
