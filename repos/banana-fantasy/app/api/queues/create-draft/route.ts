export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';
import { updateQueueRoundDraftId, fillQueueRoundWithBots } from '@/lib/db';
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
    const session = await getPrivyUser(req);
    const userId = walletFromSession(session);

    const body = await parseBody(req);
    const queueType = requireString(body.queueType, 'queueType') as 'jackpot' | 'hof';
    const roundId = requireNumber(body.roundId, 'roundId');
    actorId = userId;
    queueCtx = { queueType, roundId };

    if (queueType !== 'jackpot' && queueType !== 'hof') {
      return jsonError('Invalid queue type', 400);
    }

    // Check if queue round already has a draftId with valid Go API state
    const { getQueueStatus } = await import('@/lib/db');
    const queues = await getQueueStatus();
    const existingRound = queues[queueType]?.rounds?.find((r: { roundId: number }) => r.roundId === roundId);
    if (existingRound?.draftId) {
      try {
        const checkRes = await draftsApiServer(`/draft/${existingRound.draftId}/state/info`);
        if (checkRes.ok) {
          const info = await checkRes.json();
          if (info.draftOrder?.length >= 10) {
            logger.debug('[create-draft] Reusing existing draftId:', existingRound.draftId);
            return json({ draftId: String(existingRound.draftId) }, 200);
          }
        }
      } catch {}
    }

    const mintId = 100000 + Math.floor(Math.random() * 50000);
    await draftsApiServer(`/owner/${userId}/draftToken/mint`, {
      method: 'POST',
      body: { minId: mintId, maxId: mintId },
      wallet: userId,
    }).catch(() => {});

    const joinRes = await draftsApiServer(`/league/slow/owner/${userId}`, {
      method: 'POST',
      body: { numLeaguesToJoin: 1 },
      wallet: userId,
    });

    if (!joinRes.ok) {
      const errText = await joinRes.text().catch(() => '');
      throw new ApiError(500, `Failed to join league: ${errText}`);
    }

    const joinData = await joinRes.json().catch(() => []);
    const draftId = Array.isArray(joinData) && joinData.length > 0
      ? joinData[0]._leagueId || joinData[0].leagueId || ''
      : '';

    if (!draftId) {
      throw new ApiError(500, 'No draftId returned from JoinLeagues');
    }

    await updateQueueRoundDraftId(queueType, roundId, String(draftId));

    const { getQueueStatus: getQS } = await import('@/lib/db');
    const updatedQueues = await getQS();
    const updatedRound = updatedQueues[queueType]?.rounds?.find((r: { roundId: number }) => r.roundId === roundId);
    const actualDraftId = updatedRound?.draftId || draftId;
    logger.debug('[create-draft] JoinLeagues returned:', draftId, '| Queue stored:', actualDraftId);

    const fillRes = await draftsApiServer(
      `/staging/fill-bots/slow?count=9&leagueId=${actualDraftId}`,
      { method: 'POST' },
    ).catch(() => null);
    logger.debug('[create-draft] fill-bots result:', fillRes?.status, fillRes?.ok);

    await new Promise(r => setTimeout(r, 3000));
    let stateReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const infoRes = await draftsApiServer(`/draft/${actualDraftId}/state/info`);
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info.draftOrder && info.draftOrder.length >= 10) {
            stateReady = true;
            logger.debug('[create-draft] Draft state ready after', attempt + 1, 'attempts');
            break;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!stateReady) {
      console.warn('[create-draft] Draft state not ready after 10 attempts for', actualDraftId);
    }

    await fillQueueRoundWithBots(queueType, roundId, 9).catch(() => {});

    return json({ draftId: String(actualDraftId) }, 200);
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) return jsonError(err.message, err.status);
    logger.error(LOG_SOURCES.draft.QUEUE_UPDATE_FAILED, {
      err,
      actor: actorId,
      context: queueCtx,
    });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}
