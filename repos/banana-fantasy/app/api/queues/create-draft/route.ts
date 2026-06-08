export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { updateQueueRoundDraftId, fillQueueRoundWithBots } from '@/lib/db';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

const STAGING_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * POST /api/queues/create-draft
 *
 * Creates a Go API draft for a special draft queue round.
 * Uses JoinLeagues (which mints + joins properly) instead of create-special-draft.
 * Then fills with bots and updates the queue.
 */
export async function POST(req: Request) {
  // Hoisted so the catch can attribute the failure to the affected user.
  let actorId: string | undefined;
  let queueCtx: { queueType?: string; roundId?: number } = {};
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
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
      // Verify Go API has state for this draft
      try {
        const checkRes = await fetch(`${STAGING_API_URL}/draft/${existingRound.draftId}/state/info`);
        if (checkRes.ok) {
          const info = await checkRes.json();
          if (info.draftOrder?.length >= 10) {
            logger.debug('[create-draft] Reusing existing draftId:', existingRound.draftId);
            return json({ draftId: String(existingRound.draftId) }, 200);
          }
        }
      } catch {}
      // State doesn't exist — fall through to create new
    }

    // Slot follows the NFT: if this queue member is a wheel-won pass tied to a
    // token, build the draft for whoever owns that token RIGHT NOW — a sale while
    // the round was filling hands the slot to the buyer. Falls back to the queued
    // wallet if there's no token or the chain read fails (never lose the slot).
    let drafter = userId;
    const member = existingRound?.members?.find(
      (m: { wallet: string; tokenId?: string }) => m.wallet === userId,
    );
    if (member?.tokenId) {
      const { getOnchainOwner } = await import('@/lib/onchain/ownerOf');
      const currentOwner = await getOnchainOwner(member.tokenId);
      if (currentOwner) {
        if (currentOwner !== userId.toLowerCase()) {
          logger.debug('[create-draft] slot follows NFT:', { tokenId: member.tokenId, from: userId, to: currentOwner });
        }
        drafter = currentOwner;
      }
    }

    // 1. Mint a token (may already exist — ignore errors)
    const mintId = 100000 + Math.floor(Math.random() * 50000);
    await fetch(`${STAGING_API_URL}/owner/${drafter}/draftToken/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minId: mintId, maxId: mintId }),
    }).catch((err) => logger.warn(LOG_SOURCES.draft.QUEUE_MINT_FAILED, { err, actor: drafter, context: { mintId, queueType, roundId } }));

    // 2. Join a slow league via JoinLeagues — this properly creates token + adds to league
    const joinRes = await fetch(`${STAGING_API_URL}/league/slow/owner/${drafter}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numLeaguesToJoin: 1 }),
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

    // 3. Update the queue round in Firestore with the draftId
    await updateQueueRoundDraftId(queueType, roundId, String(draftId));

    // Re-read queue to get actual stored draftId (may differ from JoinLeagues return)
    const { getQueueStatus: getQS } = await import('@/lib/db');
    const updatedQueues = await getQS();
    const updatedRound = updatedQueues[queueType]?.rounds?.find((r: { roundId: number }) => r.roundId === roundId);
    const actualDraftId = updatedRound?.draftId || draftId;
    logger.debug('[create-draft] JoinLeagues returned:', draftId, '| Queue stored:', actualDraftId);

    // 4. Fill with 9 bots on Go API (use the actual stored draftId)
    const fillRes = await fetch(`${STAGING_API_URL}/staging/fill-bots/slow?count=9&leagueId=${actualDraftId}`, {
      method: 'POST',
    }).catch((err) => { logger.error(LOG_SOURCES.draft.QUEUE_FILL_BOTS_FAILED, { err, actor: userId, context: { leagueId: actualDraftId, queueType, roundId } }); return null; });
    logger.debug('[create-draft] fill-bots result:', fillRes?.status, fillRes?.ok);

    // 5. Wait for draft state to be created (fill-bots triggers CreateLeagueDraftStateUponFilling)
    // Give the Go backend time to process before polling
    await new Promise(r => setTimeout(r, 3000));
    // Poll getDraftInfo up to 10 times with 2s delay
    let stateReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const infoRes = await fetch(`${STAGING_API_URL}/draft/${actualDraftId}/state/info`);
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
      logger.warn(LOG_SOURCES.draft.QUEUE_STATE_NOT_READY, { actor: userId, context: { leagueId: actualDraftId, queueType, roundId, attempts: 10 } });
    }

    // 6. Sync Firestore queue: add bot members + set status to 'drafting'
    await fillQueueRoundWithBots(queueType, roundId, 9).catch((err) => logger.warn(LOG_SOURCES.draft.QUEUE_FILL_BOTS_FAILED, { err, actor: userId, context: { queueType, roundId, stage: 'firestore_sync' } }));

    // 7. Return the actual draftId to the client
    return json({ draftId: String(actualDraftId) }, 200);
  } catch (err) {
    // Expected 4xx (bad input) pass through unlogged; real 500s (join/create
    // failed, no draftId) are logged critical with the affected user.
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
