import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { recordFirstPurchaseDraftFinished } from '@/lib/db';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

/**
 * Fired from the post-draft roster page (/draft-results/[draftId]) when a user
 * has FINISHED a draft and is outside the draft room. Advances the new-user
 * first-purchase gate: it decrements the remaining-winnings counter and, when
 * that user's LAST free draft is the one that just finished, unlocks the promo
 * (popup + notification + promo box + banner). No-op once purchased / already
 * pinged, and idempotent per draftId — safe to call on every roster-page load.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  let actorId: string | undefined;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const draftId = requireString(body.draftId, 'draftId');
    actorId = userId;

    await recordFirstPurchaseDraftFinished(userId, draftId);

    return json({ ok: true }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    logger.error(LOG_SOURCES.promo.DRAFT_COMPLETE_FAILED, { err, actor: actorId });
    return jsonError('Internal Server Error', 500);
  }
}
