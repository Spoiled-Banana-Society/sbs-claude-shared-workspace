export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

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
    const reassigned = await reassignQueuePassWallet(String(tokenId), wallet);
    logger.info('queues.reassign_pass', { tokenId: String(tokenId), wallet, reassigned });
    return json({ reassigned });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('queues.reassign_pass_failed', { err });
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
