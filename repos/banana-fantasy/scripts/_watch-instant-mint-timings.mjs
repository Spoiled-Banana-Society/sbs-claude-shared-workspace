// Watch for instant-mint stage-timing breadcrumbs (added 7/22 while chasing
// the ~50s seat stall). Prints one line per new event; run under a monitor.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'lib', 'firebaseAdmin.ts'), 'utf8');
const m = /STAGING_SA_B64\s*=\s*'([^']+)'/.exec(src);
const sa = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const seen = new Set();
let cursor = new Date().toISOString();

async function poll() {
  const s = await db.collection('v2_debug_events')
    .where('serverTs', '>=', cursor)
    .orderBy('serverTs', 'asc').limit(200).get().catch(() => null);
  if (!s) return;
  for (const d of s.docs) {
    const v = d.data();
    if (!/^instant_mint_/.test(v.event || '') && v.event !== 'mint_server_result') continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    console.log(`${v.serverTs} ${v.event} ${JSON.stringify(v.payload)}`);
  }
  if (s.size) cursor = s.docs[s.docs.length - 1].data().serverTs;
}

setInterval(poll, 45_000);
poll();
