export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { backfillUsernameLower, syncDisplayNamesFromOwners } from '@/lib/usernameBackfill';

/**
 * Vercel cron — runs nightly to backfill `username_lower` on any v2_users
 * doc that's missing or stale. Covers users created or renamed via paths
 * that don't go through getPublicUsers (lazy backfill) or ensureUserSeeded.
 *
 * Scheduled in vercel.json. Auth follows the same pattern as the other
 * crons: Bearer CRON_SECRET or the x-vercel-cron header.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
  if (expected && auth !== expected && !req.headers.get('x-vercel-cron')) {
    return jsonError('Unauthorized', 401);
  }

  if (!isFirestoreConfigured()) {
    logger.warn('crons.backfill-username-lower.skipped', { reason: 'firestore-not-configured' });
    return json({ ok: false, skipped: 'no-firestore' });
  }

  try {
    const result = await backfillUsernameLower();
    const names = await syncDisplayNamesFromOwners();
    // Bell housekeeping (Boris 2026-08-28, cost cleanup): READ, UNPINNED
    // bells older than 60 days age out — every broadcast writes ~1,100 docs
    // and the collection passed 160k; nobody revisits a two-month-old read
    // notification. Pinned and unread rows are NEVER touched. 450/run hourly
    // is a ~10k/day ceiling — catches up gradually, negligible read cost.
    const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
    const db = getAdminFirestore();
    const cutoff = new Date(Date.now() - 60 * 24 * 3600_000);
    const readSnap = await db.collection('marketplace_notifications')
      .where('read', '==', true).limit(450).get();
    const batch = db.batch();
    let purged = 0;
    for (const d of readSnap.docs) {
      const x = d.data();
      const created = x.createdAt?.toDate?.() ?? null;
      if (x.pinned === true || !created || created >= cutoff) continue;
      batch.delete(d.ref); purged++;
    }
    if (purged > 0) await batch.commit();
    logger.info('crons.backfill-username-lower.done', { ...result, displayNames: names, bellsPurged: purged });
    return json({ ok: true, ...result, displayNames: names, bellsPurged: purged });
  } catch (err) {
    logger.warn('crons.backfill-username-lower.failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
