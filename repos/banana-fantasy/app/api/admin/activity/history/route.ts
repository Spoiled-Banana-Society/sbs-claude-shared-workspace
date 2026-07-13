import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';

// How many event docs we're willing to scan (newest-first) and how many
// rows we return. Scan >> return so a type filter can dig past a burst of
// other event types. Bump both as volume grows.
const SCAN_CAP = 5000;
const RETURN_CAP = 1000;

/**
 * GET /api/admin/activity/history?type=pass_purchased
 *
 * Full (non-live) history for the admin Activity table — the SSE stream
 * only carries the latest 100 events, so anything older scrolls out of
 * the live window. This returns up to RETURN_CAP matching events scanned
 * from the newest SCAN_CAP docs, newest first. `type` omitted or 'all'
 * returns every type. Response says whether the scan was exhaustive so
 * the UI can say "complete history" vs "truncated".
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return jsonError('Not configured', 503);

  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const type = (url.searchParams.get('type') || 'all').trim();

    const db = getAdminFirestore();
    const snap = await db
      .collection(ACTIVITY_EVENTS_COLLECTION)
      .orderBy('createdAtIso', 'desc')
      .limit(SCAN_CAP)
      .get();

    const events: Record<string, unknown>[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (type !== 'all' && d.type !== type) continue;
      events.push({
        id: doc.id,
        ...d,
        createdAt: (d.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
      });
      if (events.length >= RETURN_CAP) break;
    }

    // Exhaustive = we saw the full collection (scan wasn't capped) AND we
    // didn't stop early on the return cap.
    const exhaustive = snap.size < SCAN_CAP && events.length < RETURN_CAP;

    return json({ events, scanned: snap.size, exhaustive });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('admin.activity.history.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
