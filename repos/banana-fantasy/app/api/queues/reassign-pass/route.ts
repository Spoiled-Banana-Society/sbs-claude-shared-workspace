export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { reconcileSeatToOwner } from '@/lib/specialSeatReconcile';

/**
 * POST /api/queues/reassign-pass
 * Body: { tokenId, wallet }
 *
 * Fast path for the in-app marketplace buy: the buyer's browser calls this the
 * moment the purchase settles so the seat shows up on their drafting page
 * without waiting for the sweep.
 *
 * The actual work — on-chain ownership check, Go league seat swap, queue
 * bookkeeping — lives in lib/specialSeatReconcile so this route and the
 * reconcile-special-seats cron can never drift apart. That cron is the safety
 * net for every OTHER way a pass changes hands (OTC transfer, OpenSea-native
 * sale, accepted offer, or this call simply failing).
 *
 * Guarded by on-chain ownership: a seat only ever moves to the wallet that
 * actually owns the token right now, so nobody can hijack one.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const tokenId = requireString(body.tokenId, 'tokenId');
    const wallet = requireString(body.wallet, 'wallet').toLowerCase();

    const res = await reconcileSeatToOwner(tokenId, wallet);

    switch (res.reason) {
      case 'moved':
        return json({ reassigned: true });
      case 'already_owner':
        return json({ reassigned: false, alreadyOwner: true });
      case 'no_such_pass':
        // Not a queued wheel pass (or its round already completed) — nothing to move.
        return json({ reassigned: false });
      case 'round_locked':
        return jsonError('This draft already filled — the pass is locked to its owner at fill', 409);
      case 'chain_unreadable':
        return jsonError('Could not verify token ownership — try again', 503);
      default:
        return jsonError('Seat transfer failed — try again', 502);
    }
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('queues.reassign_pass_failed', { err });
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
