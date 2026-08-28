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

/**
 * Mirror Go-layer chosen display names (owners/{w}.PFP.DisplayName) onto
 * v2_users.{displayName, displayName_lower} so admin search can find users
 * by the name they actually show as. Many users never set a username —
 * v2_users still says "User-0x…" — while their real identity lives only in
 * the Go owner profile (RyRo 2026-08-28: $300 spent, unsearchable). Renames
 * happen in Go, which this layer never sees, hence a periodic mirror rather
 * than a write-through.
 */
export async function syncDisplayNamesFromOwners(): Promise<{ scanned: number; updated: number }> {
  const db = getAdminFirestore();
  const [owners, users] = await Promise.all([
    db.collection('owners').select('PFP').get(),
    db.collection('v2_users').select('displayName').get(),
  ]);
  const current = new Map<string, string | undefined>();
  users.forEach((d) => current.set(d.id, (d.data() as { displayName?: string }).displayName));
  let updated = 0;
  let batch = db.batch();
  let ops = 0;
  for (const doc of owners.docs) {
    const name = (doc.data() as { PFP?: { DisplayName?: string } }).PFP?.DisplayName?.trim();
    if (!name || /^0x/i.test(name)) continue; // unset or wallet-string default
    const w = doc.id.toLowerCase();
    if (!current.has(w) || current.get(w) === name) continue; // no user doc / already mirrored
    batch.set(db.collection('v2_users').doc(w), { displayName: name, displayName_lower: name.toLowerCase() }, { merge: true });
    updated++;
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();
  return { scanned: owners.size, updated };
}
