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
const ref = db.collection('drafts').doc('draftTracker');
const t = (await ref.get()).data();
const updated = (t.HofLeagueIds || []).filter(x => x !== target);
await ref.update({ HofLeagueIds: updated });
console.log('HofLeagueIds now:', updated);
process.exit(0);
