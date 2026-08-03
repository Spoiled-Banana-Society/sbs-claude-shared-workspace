import { logger } from '@/lib/logger';

const STAGING_API_URL =
  (process.env.NEXT_PUBLIC_STAGING_DRAFTS_API_URL ||
    'https://sbs-drafts-api-staging-652484219017.us-central1.run.app').replace(/\/$/, '');

/**
 * "The slot follows the NFT" — the one implementation.
 *
 * A wheel-won JP/HOF/JackHOF pass is a transferable NFT whose queue member row
 * carries its tokenId. Whoever owns that token is the rightful holder of the
 * seat, right up until the round fills (the Go engine hard-locks seats at 10/10:
 * staging.go SwapSpecialDraftMember rejects a full league).
 *
 * This used to be reachable ONLY from the buyer's browser after an in-app
 * marketplace buy, which left every other way a pass can change hands with a
 * stale seat: a wallet-to-wallet trade, a sale on OpenSea itself, an accepted
 * offer (the SELLER signs that one — the buyer's browser never runs), or an
 * in-app buy where the follow-up call simply failed. When that drift survived to
 * the fill it produced a seat NOBODY could play: /api/queues showed the seat to
 * the new owner (so the draft-room gate bounced the seller) while the Go engine
 * still had the seller in DraftOrder (so the buyer's picks were refused).
 * See HOF #27 / 2025-slow-draft-19, 2026-08-01.
 */

export interface SeatMoveResult {
  moved: boolean;
  reason: 'moved' | 'no_such_pass' | 'already_owner' | 'round_locked' | 'chain_unreadable' | 'swap_failed';
  tokenId: string;
  from?: string;
  to?: string;
  draftId?: string | null;
}

/**
 * Reconcile one pass's seat to its CURRENT on-chain owner.
 *
 * `expectedOwner` (optional) short-circuits the chain read when the caller has
 * already established ownership. Everything is guarded on `ownerOf` regardless:
 * a seat only ever moves TO the wallet that provably holds the token, so this is
 * not a hijack vector no matter who calls it.
 */
export async function reconcileSeatToOwner(
  tokenId: string,
  expectedOwner?: string,
): Promise<SeatMoveResult> {
  const tid = String(tokenId);

  const { getOnchainOwner } = await import('@/lib/onchain/ownerOf');
  const owner = (await getOnchainOwner(tid))?.toLowerCase();
  if (!owner) return { moved: false, reason: 'chain_unreadable', tokenId: tid };
  if (expectedOwner && owner !== expectedOwner.toLowerCase()) {
    // Caller's claim disagrees with the chain — trust the chain, move nothing.
    return { moved: false, reason: 'chain_unreadable', tokenId: tid };
  }

  const { getQueueStatus, reassignQueuePassWallet } = await import('@/lib/db');
  const queues = await getQueueStatus();

  let found: { draftId: string | null; seller: string; locked: boolean } | null = null;
  for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
    for (const round of queues[type]?.rounds || []) {
      const member = (round.members || []).find(m => m.tokenId && String(m.tokenId) === tid);
      if (!member) continue;
      found = {
        draftId: round.draftId || null,
        seller: member.wallet.toLowerCase(),
        locked: round.status !== 'filling' || (round.members || []).length >= 10,
      };
      break;
    }
    if (found) break;
  }

  if (!found) return { moved: false, reason: 'no_such_pass', tokenId: tid };
  if (found.seller === owner) return { moved: false, reason: 'already_owner', tokenId: tid, to: owner };
  if (found.locked) {
    // Seats lock at fill by design. Drift that reaches this point can only be
    // undone by hand — surface it loudly so it never sits unnoticed again.
    logger.error('special_seat.locked_with_drift', {
      tokenId: tid, draftId: found.draftId, seatWallet: found.seller, onchainOwner: owner,
    });
    return { moved: false, reason: 'round_locked', tokenId: tid, from: found.seller, to: owner, draftId: found.draftId };
  }

  // Go seat swap — the authoritative handoff. Atomic on the league doc; a league
  // that fills first wins and comes back 409.
  if (found.draftId) {
    const res = await fetch(`${STAGING_API_URL}/staging/swap-special-draft-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: found.draftId, fromWallet: found.seller, toWallet: owner }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 409) {
      logger.error('special_seat.locked_with_drift', {
        tokenId: tid, draftId: found.draftId, seatWallet: found.seller, onchainOwner: owner, via: 'go_409',
      });
      return { moved: false, reason: 'round_locked', tokenId: tid, from: found.seller, to: owner, draftId: found.draftId };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('special_seat.swap_failed', { tokenId: tid, draftId: found.draftId, status: res.status, text });
      return { moved: false, reason: 'swap_failed', tokenId: tid, from: found.seller, to: owner, draftId: found.draftId };
    }
  }

  await reassignQueuePassWallet(tid, owner);
  logger.info('special_seat.moved', { tokenId: tid, from: found.seller, to: owner, draftId: found.draftId });
  return { moved: true, reason: 'moved', tokenId: tid, from: found.seller, to: owner, draftId: found.draftId };
}

/**
 * Sweep every still-filling special round and move any seat whose pass has
 * changed hands. Returns a per-token summary for the cron's response/logs.
 */
export async function sweepSpecialSeats(): Promise<SeatMoveResult[]> {
  const { getQueueStatus } = await import('@/lib/db');
  const queues = await getQueueStatus();

  const tokenIds: string[] = [];
  for (const type of ['jackpot', 'hof', 'jackhof'] as const) {
    for (const round of queues[type]?.rounds || []) {
      if (round.status !== 'filling') continue;
      for (const m of round.members || []) if (m.tokenId) tokenIds.push(String(m.tokenId));
    }
  }

  const out: SeatMoveResult[] = [];
  for (const tid of tokenIds) {
    try {
      out.push(await reconcileSeatToOwner(tid));
    } catch (e) {
      logger.warn('special_seat.sweep_item_failed', { tokenId: tid, err: (e as Error).message });
    }
  }
  return out;
}
