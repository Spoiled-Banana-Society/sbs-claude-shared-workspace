#!/usr/bin/env node
/**
 * Backfill historical `login` events from v2_activity_events.
 *
 * Definition of a session: a stretch of activity bounded by ≥ 1h of
 * inactivity. The FIRST event in any session is a synthetic login.
 *
 * Idempotent — checks for an existing login event at the same
 * timestamp before writing. Safe to re-run.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     node scripts/backfill-session-logins.mjs [--dry-run]
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SA_PATH || !fs.existsSync(SA_PATH)) {
  console.error(`SA key not found at: ${SA_PATH}`);
  console.error(`Set GOOGLE_APPLICATION_CREDENTIALS=/Users/borisvagner/.gcp/sbs-staging-env-key.json`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'))) });
const db = getFirestore();

const SESSION_GAP_MS = 60 * 60 * 1000;
const DRY_RUN = process.argv.includes('--dry-run');
// Pre-existing `login` events came from the unreliable in-memory 6h
// throttle that Vercel cold starts kept resetting, so they over-count
// dramatically. Wipe them before the backfill so the dashboard isn't
// mixing accurate + noise. Going forward, only the new 1h-gap
// detector (lib/userEvents.recordActivityAndDetectLogin) writes them.
const WIPE_OLD = process.argv.includes('--wipe-old');

console.log(`Backfill mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE WRITE'}`);
console.log(`Wipe old logins: ${WIPE_OLD ? 'YES' : 'no (pass --wipe-old)'}`);
console.log(`Session gap: ${SESSION_GAP_MS / 60000}min\n`);

if (WIPE_OLD && !DRY_RUN) {
  console.log('Wiping pre-existing login events…');
  const oldSnap = await db.collection('v2_user_events').where('eventType', '==', 'login').limit(200_000).get();
  console.log(`  ${oldSnap.size} login events to delete`);
  let wiped = 0;
  for (let i = 0; i < oldSnap.docs.length; i += 500) {
    const batch = db.batch();
    for (const d of oldSnap.docs.slice(i, i + 500)) batch.delete(d.ref);
    await batch.commit();
    wiped += Math.min(500, oldSnap.docs.length - i);
    process.stdout.write(`  ${wiped}/${oldSnap.size}…\r`);
  }
  console.log(`\n  Done. ${wiped} old login events wiped.\n`);
}

// 1. Pull every activity event (capped, but well above current volume).
console.log('Scanning v2_activity_events…');
const actSnap = await db.collection('v2_activity_events').limit(200_000).get();
console.log(`  ${actSnap.size} activity events loaded`);

// 2. Group by user, sort ascending by createdAtIso.
const byUser = new Map();
for (const doc of actSnap.docs) {
  const d = doc.data();
  const userId = String(d.userId ?? '').toLowerCase();
  if (!userId || !/^0x[0-9a-f]{40}$/.test(userId)) continue;
  const iso = d.createdAtIso ?? d.createdAt;
  if (typeof iso !== 'string' || !iso) continue;
  if (!byUser.has(userId)) byUser.set(userId, []);
  byUser.get(userId).push(iso);
}
console.log(`  ${byUser.size} distinct users with activity\n`);

// 3. Per user, count session boundaries.
let totalSessions = 0;
const synthetic = [];  // { userId, timestamp } for each new login to write
for (const [userId, isos] of byUser) {
  isos.sort();  // lexicographic = chronological for ISO strings
  let sessions = 0;
  let lastT = -Infinity;
  for (const iso of isos) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    if (t - lastT >= SESSION_GAP_MS) {
      sessions += 1;
      synthetic.push({ userId, timestamp: iso });
    }
    lastT = t;
  }
  totalSessions += sessions;
}
console.log(`Total historical sessions inferred: ${totalSessions}`);
console.log(`  avg sessions/user: ${(totalSessions / byUser.size).toFixed(1)}\n`);

// 4. Pull all existing login events to skip duplicates.
console.log('Reading existing login events to dedupe…');
const existingSnap = await db.collection('v2_user_events').where('eventType', '==', 'login').limit(200_000).get();
const existingKeys = new Set();
for (const d of existingSnap.docs) {
  const e = d.data();
  existingKeys.add(`${(e.userId ?? '').toLowerCase()}|${e.timestamp ?? ''}`);
}
console.log(`  ${existingSnap.size} existing login events (will dedupe by userId+timestamp)\n`);

const toWrite = synthetic.filter((s) => !existingKeys.has(`${s.userId}|${s.timestamp}`));
console.log(`To write: ${toWrite.length} new login events (skipping ${synthetic.length - toWrite.length} dupes)\n`);

if (DRY_RUN) {
  console.log('DRY RUN — no writes. Re-run without --dry-run to commit.');
  process.exit(0);
}

// 5. Batch-write (Firestore limit: 500 per batch).
console.log('Writing in batches of 500…');
let written = 0;
for (let i = 0; i < toWrite.length; i += 500) {
  const chunk = toWrite.slice(i, i + 500);
  const batch = db.batch();
  for (const s of chunk) {
    const ref = db.collection('v2_user_events').doc();
    batch.set(ref, {
      userId: s.userId,
      eventType: 'login',
      timestamp: s.timestamp,
      meta: { source: 'backfill' },
    });
  }
  await batch.commit();
  written += chunk.length;
  process.stdout.write(`  ${written}/${toWrite.length}…\r`);
}
console.log(`\nDone. ${written} login events written.`);

// 6. Also backfill lastActiveAt on each user.
console.log('\nUpdating v2_users.lastActiveAt for each user with activity…');
let touched = 0;
for (const [userId, isos] of byUser) {
  const mostRecent = isos[isos.length - 1];  // already sorted asc
  if (!mostRecent) continue;
  await db.collection('v2_users').doc(userId).set({ lastActiveAt: mostRecent }, { merge: true });
  touched += 1;
  if (touched % 25 === 0) process.stdout.write(`  ${touched}…\r`);
}
console.log(`\nDone. ${touched} users updated.`);
