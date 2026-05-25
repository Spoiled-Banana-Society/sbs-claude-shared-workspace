#!/usr/bin/env node
/**
 * Backfill v2_users.lastActiveAt from v2_activity_events.
 *
 * Reads every activity event, groups by userId, sets lastActiveAt =
 * the user's most-recent event timestamp. Non-destructive — writes
 * one field per user, doesn't touch anything else.
 *
 * Boris's reason: the admin "Active this week / Inactive 14d+"
 * filter chips need accurate lastActiveAt values from day one
 * instead of waiting weeks for organic touches to populate the
 * field on every existing user.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/Users/borisvagner/.gcp/sbs-staging-env-key.json \
 *     node scripts/backfill-last-active.mjs [--dry-run]
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SA_PATH || !fs.existsSync(SA_PATH)) {
  console.error(`SA key not found at: ${SA_PATH}`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'))) });
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE WRITE'}\n`);

console.log('Scanning v2_activity_events…');
const actSnap = await db.collection('v2_activity_events').limit(200_000).get();
console.log(`  ${actSnap.size} events loaded`);

const lastByUser = new Map();  // userId → most-recent ISO
for (const doc of actSnap.docs) {
  const d = doc.data();
  const userId = String(d.userId ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(userId)) continue;
  const iso = d.createdAtIso ?? d.createdAt;
  if (typeof iso !== 'string' || !iso) continue;
  const prev = lastByUser.get(userId);
  if (!prev || iso > prev) lastByUser.set(userId, iso);
}
console.log(`  ${lastByUser.size} distinct users with activity\n`);

if (DRY_RUN) {
  console.log('Sample (first 5):');
  let n = 0;
  for (const [user, iso] of lastByUser) {
    if (n++ >= 5) break;
    console.log(`  ${user}  →  ${iso}`);
  }
  console.log('\nDRY RUN — no writes. Re-run without --dry-run to commit.');
  process.exit(0);
}

// Skip writes where lastActiveAt is already equal-or-newer (e.g. live
// traffic already touched the user via recordActivityAndDetectLogin
// since this script started).
let written = 0;
let skipped = 0;
for (const [userId, iso] of lastByUser) {
  const ref = db.collection('v2_users').doc(userId);
  const snap = await ref.get();
  const cur = (snap.data() ?? {}).lastActiveAt;
  if (typeof cur === 'string' && cur >= iso) {
    skipped += 1;
    continue;
  }
  await ref.set({ lastActiveAt: iso }, { merge: true });
  written += 1;
  if ((written + skipped) % 25 === 0) {
    process.stdout.write(`  ${written + skipped}/${lastByUser.size}…\r`);
  }
}
console.log(`\nDone. ${written} users updated, ${skipped} already fresh.`);
