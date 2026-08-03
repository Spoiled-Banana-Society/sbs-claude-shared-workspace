import { json, jsonError } from '@/lib/api/routeUtils';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { logger } from '@/lib/logger';
import { sweepSpecialSeats } from '@/lib/specialSeatReconcile';

export const dynamic = 'force-dynamic';

/**
 * Safety net for "the slot follows the NFT".
 *
 * Wheel-won JP/HOF/JackHOF passes are transferable NFTs, and the seat they hold
 * in a still-filling special draft is supposed to move with them. Until now the
 * only thing that moved it was a call from the BUYER'S BROWSER right after an
 * in-app marketplace buy — so a wallet-to-wallet trade, a sale on OpenSea, an
 * accepted offer (signed by the seller; the buyer's browser never runs), or a
 * buyer who closed the tab all left the Go league seated to the seller.
 *
 * That drift is invisible until the round fills, and then it's unfixable: seats
 * lock at 10/10, /api/queues shows the seat to the new owner (bouncing the
 * seller out of the draft room) while the engine still has the seller in
 * DraftOrder (refusing the buyer's picks). The seat auto-picks all 15 rounds for
 * nobody. That happened once — HOF #27 / 2025-slow-draft-19 on 2026-08-01 — and
 * took hand-surgery on a running draft to undo.
 *
 * Every seat only ever moves TO the wallet that provably owns the pass on-chain
 * (`ownerOf`), and only while its round is still filling, so this cannot hijack
 * a seat or disturb a started draft. Drift found on an already-locked round is
 * logged at error level (`special_seat.locked_with_drift`) rather than forced —
 * that case needs a human.
 */

function authed(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  try {
    const results = await sweepSpecialSeats();
    const moved = results.filter(r => r.moved);
    const locked = results.filter(r => r.reason === 'round_locked');
    const failed = results.filter(r => r.reason === 'swap_failed');

    if (moved.length || locked.length || failed.length) {
      logger.info('cron.reconcile_special_seats', {
        checked: results.length,
        moved: moved.map(r => ({ tokenId: r.tokenId, from: r.from, to: r.to, draftId: r.draftId })),
        locked: locked.map(r => ({ tokenId: r.tokenId, draftId: r.draftId })),
        failed: failed.map(r => r.tokenId),
      });
    }

    await recordCronHeartbeat('reconcile-special-seats');
    return json({
      checked: results.length,
      moved: moved.length,
      lockedWithDrift: locked.length,
      failed: failed.length,
      details: moved,
    });
  } catch (err) {
    logger.error('cron.reconcile_special_seats.failed', { err });
    return jsonError(err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
}
