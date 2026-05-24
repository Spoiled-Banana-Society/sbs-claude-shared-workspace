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
if (!target) { console.error('usage: node scripts/set-filled-count.mjs <count>'); process.exit(1); }

const ref = db.collection('drafts').doc('draftTracker');
const before = (await ref.get()).data();
console.log('Before FilledLeaguesCount:', before.FilledLeaguesCount, 'CurrentLiveDraftCount:', before.CurrentLiveDraftCount);
await ref.update({ FilledLeaguesCount: target, CurrentLiveDraftCount: target });
const after = (await ref.get()).data();
console.log('After  FilledLeaguesCount:', after.FilledLeaguesCount, 'CurrentLiveDraftCount:', after.CurrentLiveDraftCount);
process.exit(0);
