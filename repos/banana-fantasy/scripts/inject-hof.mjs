import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const target = Number(process.argv[2]);
if (!target) { console.error('usage: node scripts/inject-hof.mjs <leagueNum>'); process.exit(1); }

const ref = db.collection('drafts').doc('draftTracker');
const t = (await ref.get()).data();
const hofs = t.HofLeagueIds || [];
console.log('Before HofLeagueIds:', hofs);
if (hofs.includes(target)) {
  console.log(`league ${target} already in HofLeagueIds — no change needed`);
} else {
  const updated = [...hofs, target].sort((a,b) => a-b);
  await ref.update({ HofLeagueIds: updated });
  console.log('After  HofLeagueIds:', updated);
  console.log(`league ${target} will be HOF when it fills`);
}
process.exit(0);
