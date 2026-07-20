export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

/**
 * POST /api/queues/create-draft
 *
 * Self-heal for a special draft queue round's Go league. The league is normally
 * created the moment the round's FIRST wheel winner lands (wheel/spin →
 * ensureSpecialDraftSeat) and each later winner joins it — this route only
 * exists for rounds that predate league-at-win (or whose create crashed): it
 * runs the exact same ensure path, seating every current member. No bots —
 * special drafts fill with real users, like any other draft.
 */
export async function POST(req: Request) {
  let actorId: string | undefined;
  let queueCtx: { queueType?: string; roundId?: number } = {};
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const queueType = requireString(body.queueType, 'queueType') as 'jackpot' | 'hof' | 'jackhof';
    const roundId = requireNumber(body.roundId, 'roundId');
    actorId = userId;
    queueCtx = { queueType, roundId };

    if (queueType !== 'jackpot' && queueType !== 'hof' && queueType !== 'jackhof') {
      return jsonError('Invalid queue type', 400);
    }

    const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
    const seat = await ensureSpecialDraftSeat(queueType, roundId, userId);
    if (!seat.draftId) {
      throw new ApiError(500, 'Could not create or join the special draft league');
    }
    return json({ draftId: String(seat.draftId) }, 200);
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) return jsonError(err.message, err.status);
    logger.error(LOG_SOURCES.draft.QUEUE_CREATE_FAILED, {
      err,
      actor: actorId,
      context: queueCtx,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}
