import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

const USERS_COLLECTION = 'v2_users';
const BATCH_SIZE = 400; // Firestore allows 500 writes per batch; stay under.

/**
 * POST /api/admin/backfill-username-lower
 *
 * One-shot backfill that sets `username_lower = username.toLowerCase()` on
 * every v2_users doc missing or mismatched. Powers case-insensitive friend
 * search (lib/friends.ts → searchUsers).
 *
 * Idempotent — safe to re-run. Skips docs that already have a correct
 * `username_lower`. Returns counts of scanned / updated / skipped.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    const admin = await requireAdmin(req);
    const actorWallet = admin.walletAddress ?? admin.userId;
    if (!isFirestoreConfigured()) throw new ApiError(503, 'Firestore not configured');

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

    logger.info('admin.backfill-username-lower.done', { actorWallet, scanned, updated, skipped });
    return json({ ok: true, scanned, updated, skipped });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.warn('admin.backfill-username-lower.failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
