import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const src = readFileSync('./lib/firebaseAdmin.ts','utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(m[1],'base64').toString('utf8'))) });
const db = admin.firestore();
const hb = (await db.collection('cron_heartbeats').doc('mindshare-scan').get()).data();
console.log('last run:', new Date(hb.lastRunAt._seconds*1000).toISOString(), JSON.stringify(hb.lastRunSummary));
