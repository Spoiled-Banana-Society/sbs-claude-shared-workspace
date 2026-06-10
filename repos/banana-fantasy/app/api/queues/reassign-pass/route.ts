export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

const STAGING_API_URL = 'https://sbs-drafts-api-staging-652484219017.us-central1.run.app';

/**
 * POST /api/queues/reassign-pass
 * Body: { tokenId, wallet }
 *
 * After a wheel-won JP/HOF pass is bought on the marketplace while its draft is
 * still filling, the queue still records the seller — so the buyer wouldn't see
 * the filling draft on their drafting page. This moves the queue slot to the
 * buyer. Guarded by on-chain ownership: we only reassign to the wallet that
 * actually owns the token RIGHT NOW (ownerOf), so nobody can hijack a slot.
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

    const { reassignQueuePassWallet } = await import('@/lib/db');
    const res = await reassignQueuePassWallet(String(tokenId), wallet);

    // The seller created the Go draft; clearing the queue draftId above means the
    // buyer's next Enter re-creates a fresh draft for THEM. Make the seller leave
    // the old Go draft so it's freed and stops showing as theirs. Best-effort —
    // the queue handoff already succeeded regardless.
    if (res.changed && res.prevDraftId && res.prevWallet) {
      try {
        await fetch(`${STAGING_API_URL}/league/${res.prevDraftId}/actions/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: res.prevWallet, tokenId: String(tokenId) }),
        });
      } catch (e) {
        logger.warn('queues.reassign_pass.seller_leave_failed', { tokenId: String(tokenId), prevDraftId: res.prevDraftId, err: (e as Error).message });
      }
    }

    logger.info('queues.reassign_pass', { tokenId: String(tokenId), wallet, reassigned: res.changed, prevDraftId: res.prevDraftId });
    return json({ reassigned: res.changed });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('queues.reassign_pass_failed', { err });
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
