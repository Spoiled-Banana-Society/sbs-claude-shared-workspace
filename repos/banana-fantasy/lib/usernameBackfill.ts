/**
 * Bulk backfill for `v2_users.username_lower`.
 *
 * Scans every user doc, writes `username_lower = username.toLowerCase()`
 * on any doc missing or mismatched. Powers case-insensitive friend search
 * (lib/friends.ts → searchUsers).
 *
 * Idempotent — safe to re-run. Shared by the admin endpoint and the
 * daily Vercel cron.
 */

import { getAdminFirestore } from '@/lib/firebaseAdmin';

const USERS_COLLECTION = 'v2_users';
const BATCH_SIZE = 400; // Firestore caps at 500 writes per batch.

export interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
}

export async function backfillUsernameLower(): Promise<BackfillResult> {
  const db = getAdminFirestore();
  const snap = await db.collection(USERS_COLLECTION).get();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let inBatch = 0;
  const commits: Array<Promise<unknown>> = [];

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data() as { username?: string; username_lower?: string } | undefined;
    const username = data?.username;
    if (!username) { skipped++; continue; }
    const expected = username.toLowerCase();
    if (data?.username_lower === expected) { skipped++; continue; }
    batch.set(doc.ref, { username_lower: expected }, { merge: true });
    inBatch++;
    updated++;
    if (inBatch >= BATCH_SIZE) {
      commits.push(batch.commit());
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return { scanned, updated, skipped };
}
