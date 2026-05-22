/**
 * Inspect recent client-side debug logs (written to Firestore
 * v2_debug_events via /api/debug/log).
 *
 * Usage:
 *   SA_PATH=/tmp/sa-staging.json node scripts/inspect-debug-logs.mjs
 *   SA_PATH=/tmp/sa-staging.json node scripts/inspect-debug-logs.mjs --tag=league#
 *   SA_PATH=/tmp/sa-staging.json node scripts/inspect-debug-logs.mjs --wallet=0xd33...
 *   SA_PATH=/tmp/sa-staging.json node scripts/inspect-debug-logs.mjs --minutes=10
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync(process.env.SA_PATH, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://sbs-staging-env-default-rtdb.firebaseio.com',
});

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a, true];
  })
);

const tag = args.tag || null;
const wallet = (args.wallet || '').toLowerCase();
const minutes = Number(args.minutes || 30);
const limit = Number(args.limit || 200);

const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();

const fs = admin.firestore();
// Single time range + in-memory filter (avoids composite-index requirement).
const snap = await fs.collection('v2_debug_events')
  .where('serverTs', '>=', cutoff)
  .orderBy('serverTs', 'asc')
  .limit(2000)
  .get();

const filtered = snap.docs.filter(doc => {
  const d = doc.data();
  if (tag && d.tag !== tag) return false;
  if (wallet && (d.wallet || '').toLowerCase() !== wallet) return false;
  return true;
}).slice(-limit);

console.log(`=== ${filtered.length} debug events (last ${minutes} min${tag ? `, tag=${tag}` : ''}${wallet ? `, wallet=${wallet}` : ''}) ===\n`);

for (const doc of filtered) {
  const d = doc.data();
  const time = d.serverTs.slice(11, 23);
  const sess = d.sessionId ? d.sessionId.slice(0, 8) : 'no-sess';
  const wallet = d.wallet ? d.wallet.slice(0, 10) : 'no-wallet';
  const path = d.path ? `[${d.path}] ` : '';
  const payload = d.payload ? JSON.stringify(d.payload) : '';
  console.log(`${time} ${sess} ${wallet} ${path}${d.tag}.${d.event}  ${payload}`);
}

process.exit(0);
