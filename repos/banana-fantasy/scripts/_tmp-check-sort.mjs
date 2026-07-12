#!/usr/bin/env node
// Usage: node scripts/_tmp-check-sort.mjs <draftId> [wallet]
// Prints the server-side sortOrders (AutoDraft flag) for one wallet or all drafters.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const sa = JSON.parse(Buffer.from(/STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src)[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const [draftId, wallet] = process.argv.slice(2);
if (!draftId) { console.error('need draftId'); process.exit(1); }

async function show(w) {
  const s = await db.doc(`drafts/${draftId}/state/sortOrders/${w.toLowerCase()}/sort`).get();
  console.log(w, '→', s.exists ? JSON.stringify(s.data()) : 'NO DOC');
}

if (wallet) {
  await show(wallet);
} else {
  const league = (await db.doc(`drafts/${draftId}`).get()).data();
  for (const u of league.CurrentUsers || []) await show(u.OwnerId || u.ownerId);
}
process.exit(0);
