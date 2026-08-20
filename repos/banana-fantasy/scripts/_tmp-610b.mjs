import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('./lib/firebaseAdmin.ts','utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1],'base64').toString('utf8'))), databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const db = admin.firestore();
const rt = admin.database();
// maybe they mean BBB #610 (a slow draft named 610) or slow-draft id variants
const q = await db.collection('drafts').where('DisplayName','==','BBB #610').get();
for (const d of q.docs) console.log('BBB #610 =', d.id);
// list slow drafts around 610 and any stuck slow drafts (started, not complete, pickEnd long past)
const snap = (await rt.ref('drafts').get()).val() || {};
const now = Math.floor(Date.now()/1000);
for (const [id, d] of Object.entries(snap)) {
  if (!/slow-draft/.test(id)) continue;
  const info = d?.realTimeDraftInfo || {};
  if (info.draftStartTime && !info.isDraftComplete) {
    const stale = info.pickEndTime ? now - info.pickEndTime : null;
    console.log(id, JSON.stringify({ name: d.displayName || null, pick: info.pickNumber, curr: (info.currentDrafter||'').slice(0,10), pickEnd: info.pickEndTime, staleSec: stale }));
  }
}
