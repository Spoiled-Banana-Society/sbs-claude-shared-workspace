import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('./lib/firebaseAdmin.ts','utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1],'base64').toString('utf8'))), databaseURL:'https://sbs-staging-env-default-rtdb.firebaseio.com' });
const rt = admin.database();
for (const d of ['2025-slow-draft-22','2025-slow-draft-31']) {
  const info = (await rt.ref(`drafts/${d}/realTimeDraftInfo`).get()).val() || {};
  const { draftOrder, picks, ...rest } = info;
  console.log(d, JSON.stringify(rest).slice(0,800));
  const dn = (await rt.ref(`drafts/${d}/displayName`).get()).val();
  console.log('  displayName:', dn);
}
const db = admin.firestore();
for (const col of ['v2_drafts','drafts','v2_leagues','draft_records','v2_completed_drafts']) {
  const s = await db.collection(col).doc('2025-slow-draft-22').get().catch(()=>null);
  if (s && s.exists) { const x=s.data(); console.log(col, JSON.stringify({type:x.type,draftType:x.draftType,specialType:x.specialType,level:x.level,isJackpot:x.isJackpot,isHof:x.isHof,name:x.name||x.displayName})); }
}
