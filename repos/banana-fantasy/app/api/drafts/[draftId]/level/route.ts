import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

/**
 * GET /api/drafts/{draftId}/level
 *
 * Authoritative draft TYPE for a draft: `{ level: 'Jackpot' | 'Hall of Fame' |
 * 'Pro' }` (empty string if not yet known). Source of truth is the Firestore
 * draft doc `Level`, stamped at the slot-machine reveal — well before the
 * results / generating screen renders.
 *
 * Why this exists: the Go `/draft/{id}/state/info` endpoint does NOT return the
 * type, so anything deriving it from that response fell through to a 'Pro'
 * default — making jackpot/HOF drafts render pro/purple. This is a
 * Firestore-only read (no Go round-trip) so it resolves fast enough that the
 * type is known before the team card / badge paint, with no wrong-type flash.
 */
export async function GET(req: Request, ctx: { params: { draftId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const draftId = ctx.params.draftId?.trim();
    if (!draftId) return jsonError('Missing draftId', 400);
    if (!isFirestoreConfigured()) return json({ level: '' });

    const snap = await getAdminFirestore().collection('drafts').doc(draftId).get();
    const data = snap.data() as { Level?: unknown } | undefined;
    return json({ level: String(data?.Level ?? '') });
  } catch (err) {
    logger.error('drafts.level.failed', { route: '/api/drafts/[draftId]/level', err });
    return json({ level: '' });
  }
}
