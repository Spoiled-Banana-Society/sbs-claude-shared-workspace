export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { updateQueueRoundDraftId, fillQueueRoundWithBots } from '@/lib/db';
import { logger } from '@/lib/logger';

const STAGING_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * POST /api/queues/create-draft
 *
 * Creates a Go API draft for a special draft queue round.
 * Uses JoinLeagues (which mints + joins properly) instead of create-special-draft.
 * Then fills with bots and updates the queue.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const queueType = requireString(body.queueType, 'queueType') as 'jackpot' | 'hof';
    const roundId = requireNumber(body.roundId, 'roundId');

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

    // 1. Mint a token (may already exist — ignore errors)
    const mintId = 100000 + Math.floor(Math.random() * 50000);
    await fetch(`${STAGING_API_URL}/owner/${userId}/draftToken/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minId: mintId, maxId: mintId }),
    }).catch(() => {});

    // 2. Join a slow league via JoinLeagues — this properly creates token + adds to league
    const joinRes = await fetch(`${STAGING_API_URL}/league/slow/owner/${userId}`, {
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
    }).catch(() => null);
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
    }

    // 6. Sync Firestore queue: add bot members + set status to 'drafting'
    await fillQueueRoundWithBots(queueType, roundId, 9).catch(() => {});

    // 7. Return the actual draftId to the client
    return json({ draftId: String(actualDraftId) }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}
