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

const ref = db.collection('drafts').doc('draftTracker');
const t = (await ref.get()).data();
console.log('FilledLeaguesCount:', t.FilledLeaguesCount);
console.log('CurrentLiveDraftCount (fast pointer):', t.CurrentLiveDraftCount);
console.log('CurrentSlowDraftCount:', t.CurrentSlowDraftCount);
console.log('HofLeagueIds (positions 1-100 of current batch):', t.HofLeagueIds);
console.log('JackpotLeagueIds:', t.JackpotLeagueIds);

const filled = t.FilledLeaguesCount;
const batchStart = Math.floor(filled / 100) * 100;
const positionInBatch = (filled % 100) + 1;
console.log(`\nNext draft fills as position ${positionInBatch} of current batch [${batchStart+1}..${batchStart+100}]`);
const hofs = (t.HofLeagueIds || []).filter(p => p >= positionInBatch);
console.log(`HOF positions ahead this batch:`, hofs.length ? hofs : '(none)');
const jps = (t.JackpotLeagueIds || []).filter(p => p >= positionInBatch);
console.log(`Jackpot positions ahead this batch:`, jps.length ? jps : '(none)');

process.exit(0);
