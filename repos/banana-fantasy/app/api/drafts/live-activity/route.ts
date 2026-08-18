import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { getLiveActivityCached } from '@/lib/liveActivityServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/drafts/live-activity → { count, round, updatedAt }
 * "How many FAST drafts are drafting right now + furthest round" — computed by
 * lib/liveActivityServer (see there for why we don't read the Go aggregator).
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  if (!isFirestoreConfigured()) return json({ count: 0, round: 0, updatedAt: Date.now() });
  return json(await getLiveActivityCached());
}
