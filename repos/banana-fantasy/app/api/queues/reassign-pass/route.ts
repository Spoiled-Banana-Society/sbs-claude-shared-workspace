export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

const STAGING_API_URL = process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL || 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * POST /api/queues/reassign-pass
 * Body: { tokenId, wallet }
 *
 * After a wheel-won JP/HOF pass is bought on the marketplace while its draft is
 * still filling, this hands the seat to the buyer:
 *   1. Go league seat swap (authoritative — seller's special token destroyed,
 *      buyer seated in the same league; atomic, rejected once the draft fills).
 *   2. Firestore queue member rewrite (bookkeeping — the lobby/drafting page
 *      read this; the on-chain owner overlay self-heals it regardless).
 * Guarded by on-chain ownership: we only reassign to the wallet that actually
 * owns the token RIGHT NOW (ownerOf), so nobody can hijack a seat.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const tokenId = requireString(body.tokenId, 'tokenId');
    const wallet = requireString(body.wallet, 'wallet').toLowerCase();

    // Authoritative check: the claimer must be the current on-chain owner.
    const { getOnchainOwner } = await import('@/lib/onchain/ownerOf');
    const owner = await getOnchainOwner(tokenId);
    if (!owner) return jsonError('Could not verify token ownership — try again', 503);
    if (owner !== wallet) {
      return jsonError('That wallet does not own this token', 403);
    }

    // Locate the pass's still-filling round (the only state a seat can move in).
    const { getQueueStatus, reassignQueuePassWallet } = await import('@/lib/db');
    const queues = await getQueueStatus();
    let found: { draftId: string | null; seller: string; full: boolean } | null = null;
    for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
      for (const round of queues[type]?.rounds || []) {
        const member = (round.members || []).find(m => m.tokenId && String(m.tokenId) === String(tokenId));
        if (!member) continue;
        found = {
          draftId: round.draftId || null,
          seller: member.wallet.toLowerCase(),
          full: round.status !== 'filling' || (round.members || []).length >= 10,
        };
        break;
      }
      if (found) break;
    }

    if (!found) {
      // Not a queued wheel pass (or round already completed) — nothing to move.
      return json({ reassigned: false });
    }
    if (found.full) {
      return jsonError('This draft already filled — the pass is locked to its owner at fill', 409);
    }
    if (found.seller === wallet) {
      return json({ reassigned: false, alreadyOwner: true });
    }

    // 1. Go seat swap — the real handoff. Atomic on the league doc; a filled
    //    league rejects with 409, so a sale can never displace a started draft.
    if (found.draftId) {
      const swapRes = await fetch(`${STAGING_API_URL}/staging/swap-special-draft-member`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: found.draftId, fromWallet: found.seller, toWallet: wallet }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!swapRes.ok && swapRes.status !== 409) {
        const text = await swapRes.text().catch(() => '');
        logger.error('queues.reassign_pass.swap_failed', { tokenId: String(tokenId), draftId: found.draftId, status: swapRes.status, text });
        return jsonError('Seat transfer failed — try again', 502);
      }
      if (swapRes.status === 409) {
        return jsonError('This draft already filled — the pass is locked to its owner at fill', 409);
      }
    }

    // 2. Firestore queue bookkeeping (display path; owner overlay self-heals it).
    const res = await reassignQueuePassWallet(String(tokenId), wallet);

    logger.info('queues.reassign_pass', { tokenId: String(tokenId), wallet, reassigned: res.changed, prevDraftId: found.draftId });
    return json({ reassigned: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('queues.reassign_pass_failed', { err });
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
