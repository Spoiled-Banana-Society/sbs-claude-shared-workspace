import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { recordDraftCompletion, recomputeUserExposure } from '@/lib/db';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  let actorId: string | undefined;
  try {
    // Best-effort authorization. This promo write fires automatically from the
    // draft room WITHOUT an Authorization header, so a MISSING token must NOT
    // reject the call (requiring one regressed all promo recording — daily
    // drafts stopped crediting). If a token IS present we enforce that it
    // matches the userId, so an authenticated session can't record another
    // wallet's promo. The real protection lives in recordDraftCompletion
    // (resolveDraftPassType blocks free passes + per-draft dedupe). Fully
    // closing the "trust the client" gap — verify the caller actually holds a
    // paid token for this draft — is a separate, tested change.
    let authedWallet: string | null = null;
    try {
      const { walletAddress } = await getPrivyUser(req);
      authedWallet = (walletAddress || '').toLowerCase();
    } catch {
      authedWallet = null; // no/invalid token — fall through to server-side gates
    }
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    if (authedWallet && authedWallet !== userId.toLowerCase()) {
      return jsonError('Forbidden — wallet mismatch', 403);
    }
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
