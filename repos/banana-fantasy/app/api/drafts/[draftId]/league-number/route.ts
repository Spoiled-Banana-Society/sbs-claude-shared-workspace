import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/drafts/{draftId}/league-number
 *
 * Resolves a draftId to its global league number. Needed because the
 * slot-id counter (`{year}-{speed}-draft-N`, per-speed-per-year) drifts
 * from the global FilledLeaguesCount over time — so `parseDraftNumber`
 * on a slot id can return a number that maps to the wrong batch.
 *
 * Source of truth: the doc's DisplayName field ("BBB #N").
 *
 * Returns `{ leagueNumber: <N> }` or 404 if the doc / DisplayName
 * doesn't exist.
 */
export async function GET(req: Request, ctx: { params: { draftId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const draftId = ctx.params.draftId?.trim();
    if (!draftId) return jsonError('Missing draftId', 400);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const db = getAdminFirestore();
    const snap = await db.collection('drafts').doc(draftId).get();
    if (!snap.exists) return jsonError('Draft not found', 404);

    const data = snap.data() as { DisplayName?: string } | undefined;
    const m = /^BBB\s*#(\d+)$/i.exec(data?.DisplayName ?? '');
    if (!m) return jsonError('No DisplayName / not yet a league', 404);

    return json({ leagueNumber: Number(m[1]) });
  } catch (err) {
    logger.error('drafts.league_number.failed', {
      route: '/api/drafts/[draftId]/league-number',
      err,
    });
    return jsonError('Internal Server Error', 500);
  }
}
