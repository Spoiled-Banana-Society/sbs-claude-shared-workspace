import { logger } from '@/lib/logger';

const STAGING_API_URL =
  (process.env.STAGING_DRAFTS_API_URL ||
    'https://sbs-drafts-api-staging-652484219017.us-central1.run.app').replace(/\/$/, '');

/**
 * Special wheel-won JP/HOF drafts — real-user fill.
 *
 * The FIRST wheel winner's win creates the actual Go league (so the draft room
 * lobby exists from minute one); every later winner JOINS that same league.
 * The Go engine fires CreateLeagueDraftStateUponFilling at 10/10 — exactly like
 * a regular draft filling — which starts the draft and the normal draft-start
 * notification pipeline. When that happens we flip the Firestore queue round to
 * 'drafting' in the same breath, which atomically CLOSES the sell window
 * (listing eligibility, wheel-pass browse, purchase guard and seat reassign all
 * gate on the round status).
 */

interface SeatResult {
  draftId: string | null;
  numPlayers: number | null;
}

async function goPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${STAGING_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

/** Resolve who holds each seat RIGHT NOW: token-bound seats follow the NFT's
 *  current on-chain owner (a sale-while-filling hands the seat to the buyer);
 *  wallet-keyed legacy seats stay with the queued wallet. */
async function resolveSeatWallets(
  members: Array<{ wallet: string; tokenId?: string }>,
): Promise<string[]> {
  const out: string[] = [];
  for (const m of members) {
    let seat = m.wallet.toLowerCase();
    if (m.tokenId) {
      try {
        const { getOnchainOwner } = await import('@/lib/onchain/ownerOf');
        const owner = await getOnchainOwner(m.tokenId);
        if (owner) seat = owner.toLowerCase();
      } catch { /* chain read failed — never lose the seat, keep queued wallet */ }
    }
    out.push(seat);
  }
  return out;
}

/** The round hit 10/10: close the sell window and hide/cancel cached listings.
 *  The Go engine already started the draft and fired the start notifications. */
async function onRoundFilled(type: 'jackpot' | 'hof' | 'jackhof', roundId: number): Promise<void> {
  const { markQueueRoundDrafting } = await import('@/lib/db');
  const res = await markQueueRoundDrafting(type, roundId);
  if (!res.changed) return;
  logger.info('special_draft.round_filled', { type, roundId, members: res.members.length });
  // Cached marketplace listings for these passes must stop showing Buy Now the
  // moment the draft starts. Best-effort — the status flip above is the real
  // guard (purchases check it server-side before fulfillment).
  for (const m of res.members) {
    if (!m.tokenId) continue;
    try {
      const { recordCancelled } = await import('@/lib/marketplace/listingCache');
      await recordCancelled(String(m.tokenId), m.wallet);
    } catch (e) {
      logger.warn('special_draft.delist_at_fill_failed', {
        tokenId: m.tokenId,
        err: (e as Error).message,
      });
    }
  }
}

/**
 * Ensure `wallet` holds a seat in the Go league for queue round `roundId`,
 * creating the league if this round doesn't have one yet. Exactly one
 * concurrent caller wins the creation claim; the rest join (or briefly wait
 * for the creator to finish). Idempotent end to end.
 */
export async function ensureSpecialDraftSeat(
  type: 'jackpot' | 'hof' | 'jackhof',
  roundId: number,
  wallet: string,
): Promise<SeatResult> {
  const w = wallet.toLowerCase();
  const { claimSpecialDraftCreation, clearQueueRoundCreating, updateQueueRoundDraftId, getQueueStatus } =
    await import('@/lib/db');

  for (let attempt = 0; attempt < 10; attempt++) {
    const claim = await claimSpecialDraftCreation(type, roundId);

    if (claim.draftId) {
      // Only a wallet that actually holds a seat in this round may be joined —
      // the round membership (with token-bound seats resolved to their CURRENT
      // on-chain owner) is the guest list. Without this, anyone could post a
      // wallet at the self-heal route and seat themselves in a special draft.
      const queues = await getQueueStatus();
      const round = queues[type]?.rounds?.find(r => r.roundId === roundId);
      const seatWallets = await resolveSeatWallets(round?.members || []);
      if (!seatWallets.includes(w)) {
        logger.warn('special_draft.join_denied_not_member', { type, roundId, wallet: w });
        return { draftId: claim.draftId, numPlayers: null };
      }
      // Token-bound seat: pass the wheel-pass NFT id so the Go engine binds the
      // seat token to the REAL on-chain pass (RealTokenId) and consumes its
      // spendable doc — the pass can't also be spent on a regular draft.
      const seatIdx = seatWallets.indexOf(w);
      const seatTokenId = seatIdx >= 0 ? (round?.members || [])[seatIdx]?.tokenId : undefined;
      const res = await goPost('/staging/join-special-draft', {
        draftId: claim.draftId,
        wallet: w,
        ...(seatTokenId ? { tokenId: String(seatTokenId) } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error('special_draft.join_failed', { type, roundId, draftId: claim.draftId, wallet: w, status: res.status, text });
        return { draftId: claim.draftId, numPlayers: null };
      }
      const data = await res.json().catch(() => ({}));
      const numPlayers = typeof data.numPlayers === 'number' ? data.numPlayers : null;
      if (numPlayers !== null && numPlayers >= 10) await onRoundFilled(type, roundId);
      return { draftId: claim.draftId, numPlayers };
    }

    if (claim.claimed) {
      try {
        // Create the league with EVERY seat the round already holds (normally
        // just this winner — but a legacy round that predates league-at-win
        // gets all its members seated at once).
        const queues = await getQueueStatus();
        const round = queues[type]?.rounds?.find(r => r.roundId === roundId);
        const members = round?.members?.length ? round.members : [{ wallet: w }];
        const wallets = await resolveSeatWallets(members);
        // Pass roundId so the Go create is IDEMPOTENT per round — a repeated/
        // concurrent create for the same round resolves to the same draftId
        // instead of spawning a second league / duplicate seat tokens.
        //
        // `source` rides along so the league records how its seats were won.
        // The engine reads it back at fill for the "(from Wheel)"/"(from Promo)"
        // suffix — a promo round used to announce itself as a wheel win. Same
        // default as roundSource(): an untagged round is a wheel round.
        const source = round?.source ?? 'wheel';
        const res = await goPost('/staging/create-special-draft', { type, wallets, roundId, source });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`create-special-draft ${res.status}: ${text}`);
        }
        const data = await res.json().catch(() => ({}));
        const draftId = String(data.draftId || '');
        if (!draftId) throw new Error('create-special-draft returned no draftId');
        await updateQueueRoundDraftId(type, roundId, draftId);
        const numPlayers = typeof data.numPlayers === 'number' ? data.numPlayers : wallets.length;
        logger.info('special_draft.league_created', { type, roundId, draftId, numPlayers });
        if (numPlayers >= 10) await onRoundFilled(type, roundId);
        return { draftId, numPlayers };
      } catch (e) {
        await clearQueueRoundCreating(type, roundId).catch(() => {});
        logger.error('special_draft.create_failed', { type, roundId, wallet: w, err: (e as Error).message });
        return { draftId: null, numPlayers: null };
      }
    }

    // Someone else is mid-create — give them a moment, then re-check.
    await new Promise(r => setTimeout(r, 1500));
  }

  logger.error('special_draft.ensure_seat_timeout', { type, roundId, wallet: w });
  return { draftId: null, numPlayers: null };
}
