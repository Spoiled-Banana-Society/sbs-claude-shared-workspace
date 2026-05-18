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
let q = fs.collection('v2_debug_events').where('serverTs', '>=', cutoff);
if (tag) q = q.where('tag', '==', tag);
if (wallet) q = q.where('wallet', '==', wallet);
const snap = await q.orderBy('serverTs', 'asc').limit(limit).get();

console.log(`=== ${snap.size} debug events (last ${minutes} min${tag ? `, tag=${tag}` : ''}${wallet ? `, wallet=${wallet}` : ''}) ===\n`);

for (const doc of snap.docs) {
  const d = doc.data();
  const time = d.serverTs.slice(11, 23);
  const sess = d.sessionId ? d.sessionId.slice(0, 8) : 'no-sess';
  const wallet = d.wallet ? d.wallet.slice(0, 10) : 'no-wallet';
  const path = d.path ? `[${d.path}] ` : '';
  const payload = d.payload ? JSON.stringify(d.payload) : '';
  console.log(`${time} ${sess} ${wallet} ${path}${d.tag}.${d.event}  ${payload}`);
}

process.exit(0);
