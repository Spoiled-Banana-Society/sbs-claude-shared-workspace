#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const env = readFileSync('.env.production','utf8');
const sa = JSON.parse(Buffer.from(env.match(/^FIREBASE_SERVICE_ACCOUNT_JSON=([A-Za-z0-9+/=]+)/m)[1],'base64').toString('utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
console.log('id-keyed / draft-data collections (era-reuse ghost sources):');
for (const c of ['draftTokenMetadata','draftTokens','marketplace_index','draftTokenCounters','finalizedDrafts','draftTokenMeta']) {
  try { const n = (await db.collection(c).count().get()).data().count; console.log(`  ${c.padEnd(22)} ${n} docs`); }
  catch(e){ console.log(`  ${c.padEnd(22)} (n/a)`); }
}
process.exit(0);
