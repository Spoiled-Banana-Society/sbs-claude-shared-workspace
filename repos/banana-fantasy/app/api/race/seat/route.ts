/**
 * POST /api/race/seat — seat ONE Banana Race winner (lib/bananaRace.ts).
 *
 * Driven by scripts/_banana-race-seat.mjs on Tuesday at 6 PM PT, one call per
 * seat, in plan order. Auth: `Bearer <seatKey>` where sha256(seatKey) equals
 * banana_race/plan.seatKeyHash — a one-time key the freeze script generates
 * and prints, valid until plan.validUntilIso. No Vercel env involved, and the
 * key dies with the plan. This route mints passes, so it is never open.
 *
 * Body: { wallet, tier: 'jackhof'|'jackpot'|'hof', roundId?: number, reason?: string,
 *         fast?: boolean, tokenId?: string }
 *   tokenId given   → MERGE mode: the wallet already holds this pass (its old
 *                     league was folded into this one); no mint, just queue +
 *                     Go seat. The script removed the old seat first.
 *   roundId given   → seat into THAT round (the plan's league). Refuses if the
 *                     round is full, not filling, or already holds this person.
 *   roundId omitted → open a brand-new 'race' round for this wallet (the
 *                     overflow league for a top-N winner seated everywhere).
 *   fast            → stamp DraftType 'fast' on the league doc BEFORE joining,
 *                     so if this seat is the 10th the Go fill creates a 30s
 *                     clock. The script passes it on every seat of a league it
 *                     intends to draft tonight.
 *
 * What one seat does (same path as a Drop pack JackHOF seat, lib/dropRun.ts):
 *   1. admin-mint a real pass NFT to the wallet, pass_origin admin_grant
 *      (free origin — never counted as revenue), level stamped so the pass can
 *      only ever be spent on this tier,
 *   2. queue the pass into the target round (joinQueueRoundWithToken),
 *   3. ensureSpecialDraftSeat → Go join-special-draft binds RealTokenId; at
 *      10/10 the Go engine starts the draft and the round flips to 'drafting'.
 * Idempotent per (wallet, round): a retry finds the token already queued.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readBananaRaceConfig, RACE_COLLECTION, type SpecialTier } from '@/lib/bananaRace';

async function authed(req: Request): Promise<boolean> {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return false;
  const snap = await getAdminFirestore().collection(RACE_COLLECTION).doc('plan').get();
  const plan = snap.data() as { seatKeyHash?: string; validUntilIso?: string } | undefined;
  if (!plan?.seatKeyHash || !plan.validUntilIso) return false;
  if (Date.parse(plan.validUntilIso) < Date.now()) return false;
  const hash = createHash('sha256').update(bearer).digest('hex');
  return hash.length === plan.seatKeyHash.length && timingSafeEqual(Buffer.from(hash), Buffer.from(plan.seatKeyHash));
}

const LEVEL: Record<SpecialTier, 'JackHOF' | 'Jackpot' | 'HOF'> = { jackhof: 'JackHOF', jackpot: 'Jackpot', hof: 'HOF' };

export async function POST(req: Request) {
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  if (!(await authed(req))) return jsonError('Unauthorized', 401);
  const cfg = await readBananaRaceConfig({ fresh: true });
  if (!cfg.enabled) return jsonError('Banana Race is off', 409);

  try {
    const body = await parseBody(req);
    const wallet = requireString(body.wallet, 'wallet').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return jsonError('bad wallet', 400);
    const tier = requireString(body.tier, 'tier') as SpecialTier;
    if (!(tier in LEVEL)) return jsonError('tier must be jackhof|jackpot|hof', 400);
    const roundId = typeof body.roundId === 'number' && Number.isInteger(body.roundId) ? body.roundId : null;
    const reason = typeof body.reason === 'string' && body.reason ? body.reason : 'banana-race';
    const fast = body.fast === true;
    const existingTokenId = typeof body.tokenId === 'string' && body.tokenId ? body.tokenId : null;
    if (!existingTokenId && !isAdminMintConfigured()) return jsonError('Admin mint not configured', 503);

    const db = getAdminFirestore();
    const { joinQueueRoundWithToken, joinQueueWithToken, getQueueStatus } = await import('@/lib/db');

    // Pre-flight the target round so we never mint a pass we can't seat.
    if (roundId !== null) {
      const queues = await getQueueStatus();
      const round = queues[tier]?.rounds?.find((r) => r.roundId === roundId);
      if (!round) return jsonError(`round ${roundId} not found`, 404);
      if (round.status !== 'filling') return jsonError(`round ${roundId} is ${round.status}`, 409);
      if ((round.members?.length ?? 0) >= 10) return jsonError(`round ${roundId} is full`, 409);
    }

    // 1. Mint the pass (or reuse the merged-in pass).
    let tokenId: string;
    let txHash: string | null = null;
    if (existingTokenId) {
      tokenId = existingTokenId;
    } else {
      const res = await reserveTokensToWallet({ to: wallet, count: 1 });
      if (!res.tokenIds[0]) return jsonError('mint returned no token', 500);
      tokenId = String(res.tokenIds[0]);
      txHash = res.txHash;
      await recordPassOrigins({
        tokenIds: res.tokenIds, origin: 'admin_grant', ownerAtMint: wallet,
        txHash: res.txHash, reason: `banana-race:${reason}`, level: tier,
      });
      await registerMintedTokens(wallet, res.tokenIds, 'free')
        .catch((e) => logger.warn('banana_race.register_go_failed', { wallet, err: (e as Error).message }));
      await db.collection('owners').doc(wallet).collection('validDraftTokens').doc(tokenId)
        .set({ Level: LEVEL[tier] }, { merge: true });
    }

    // 2. Queue it into the plan's round (or a fresh race round).
    let joinedRoundId: number | null;
    if (roundId !== null) {
      joinedRoundId = (await joinQueueRoundWithToken(wallet, tier, roundId, tokenId)).joinedRoundId;
    } else {
      joinedRoundId = (await joinQueueWithToken(wallet, tier, tokenId, 'race')).joinedRoundId;
    }
    if (joinedRoundId === null) return jsonError('queue join failed', 500, { tokenId });

    // 3. Fast clock tonight: the Go fill reads DraftType off the league doc.
    if (fast) {
      const queues = await getQueueStatus();
      const round = queues[tier]?.rounds?.find((r) => r.roundId === joinedRoundId);
      if (round?.draftId) {
        await db.collection('drafts').doc(round.draftId).set({ DraftType: 'fast' }, { merge: true });
      }
    }

    // 4. Go seat (creates the league on a fresh round, joins otherwise).
    const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
    const seat = await ensureSpecialDraftSeat(tier, joinedRoundId, wallet);
    if (fast && seat.draftId) {
      // A fresh league was just created slow by default — flip it now, before
      // its 10th seat can land.
      await db.collection('drafts').doc(seat.draftId).set({ DraftType: 'fast' }, { merge: true });
    }
    logger.info('banana_race.seated', { wallet, tier, roundId: joinedRoundId, draftId: seat.draftId, numPlayers: seat.numPlayers, tokenId });
    return json({ ok: true, wallet, tier, roundId: joinedRoundId, draftId: seat.draftId, numPlayers: seat.numPlayers, tokenId, txHash, merged: !!existingTokenId });
  } catch (err) {
    logger.error('banana_race.seat_failed', { err: (err as Error).message });
    return jsonError((err as Error).message || 'Internal Server Error', 500);
  }
}
