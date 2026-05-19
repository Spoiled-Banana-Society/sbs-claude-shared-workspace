import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/drafts/league/{n}
 *
 * Reverse lookup: takes a league number (e.g. 817) and returns the
 * slot id (e.g. "2024-fast-draft-816"). Powers the pretty
 * `?league=N` URL on the draft-room page — when the page loads with
 * `?league=817`, it calls this endpoint to resolve the actual draft id
 * for API calls.
 *
 * Source of truth: matches against the doc's `DisplayName` field
 * (`BBB #N`). Queue drafts and special drafts (Jackpot/HOF) are not
 * matched here — they don't follow the BBB # numbering and continue
 * to use `?id=` directly.
 *
 * Returns `{ draftId: "<slot-id>" }` or 404 if no draft matches.
 */
export async function GET(req: Request, ctx: { params: { n: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const raw = ctx.params.n?.trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return jsonError('Invalid league number', 400);
    if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);

    const db = getAdminFirestore();
    const snap = await db
      .collection('drafts')
      .where('DisplayName', '==', `BBB #${n}`)
      .limit(1)
      .get();

    if (snap.empty) return jsonError('Draft not found for league number', 404);

    const draftId = snap.docs[0].id;
    return json({ draftId, leagueNumber: n });
  } catch (err) {
    logger.error('drafts.league_to_slot.failed', {
      route: '/api/drafts/league/[n]',
      err,
    });
    return jsonError('Internal Server Error', 500);
  }
}
