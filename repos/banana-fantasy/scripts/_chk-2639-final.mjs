import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync('/Users/richardvagner/Downloads/sbs-staging-env-firebase-adminsdk-fbsvc-855fc9af81.json', 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
for (const id of ['2639', '873']) {
  const ix = await db.collection('marketplace_index').doc(id).get();
  const d = ix.data() ?? {};
  const ps = (d.players ?? []);
  console.log(`marketplace_index/${id}: status=${d.status} level=${d.level} league#=${d.leagueNumber}`);
  console.log(`  players(${ps.length}):`, ps.map(p => `${p.team}-${p.pos}@${p.pick}`).join(' '));
}
process.exit(0);
