import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('./lib/firebaseAdmin.ts','utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1],'base64').toString('utf8'))), databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const rt = admin.database();
const tracker = (await rt.ref('drafts/draftTracker').get()).val() || {};
console.log('tracker keys:', Object.keys(tracker).join(','));
console.log('RecentFills tail:', JSON.stringify((tracker.RecentFills||[]).slice(-4)));
console.log('FilledLeaguesCount:', tracker.FilledLeaguesCount);
// current fast lobby state
const lobby = (await rt.ref('drafts/currentDraft').get()).val();
if (lobby) console.log('currentDraft:', JSON.stringify(lobby).slice(0,300));
const keys = (await rt.ref('drafts').get()).val();
const ids = Object.keys(keys||{}).filter(k=>k.startsWith('2026-fast')).sort((a,b)=>Number(a.split('-').pop())-Number(b.split('-').pop())).slice(-3);
for (const id of ids) {
  const info = keys[id]?.realTimeDraftInfo || {};
  console.log(id, JSON.stringify({numPlayers:keys[id]?.numPlayers, draftStartTime:info.draftStartTime, pickNumber:info.pickNumber, isDraftComplete:info.isDraftComplete, randomizeStartAt:keys[id]?.randomizeStartAt, displayName:keys[id]?.displayName}).slice(0,260));
}
