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
    logger.info('crons.backfill-username-lower.done', { ...result, displayNames: names });
    return json({ ok: true, ...result, displayNames: names });
  } catch (err) {
    logger.warn('crons.backfill-username-lower.failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
