import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { recordDraftCompletion, recomputeUserExposure } from '@/lib/db';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  let actorId: string | undefined;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const draftId = requireString(body.draftId, 'draftId');
    actorId = userId;
    // Free-pass drafts earn no promo credit (server-enforced).
    const passType = typeof body.passType === 'string' ? body.passType : undefined;

    const promo = await recordDraftCompletion(userId, draftId, passType);

    // Fire-and-forget exposure recompute. Idempotent + reads from the Go
    // API, so runs in the background without blocking the response.
    void recomputeUserExposure(userId).catch((err) => logger.warn(LOG_SOURCES.promo.EXPOSURE_RECOMPUTE_FAILED, { err, actor: userId, context: { draftId } }));

    return json({ promo }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    logger.error(LOG_SOURCES.promo.DRAFT_COMPLETE_FAILED, { err, actor: actorId });
    return jsonError('Internal Server Error', 500);
  }
}
