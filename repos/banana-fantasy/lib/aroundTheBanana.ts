/**
 * Around The Banana — draft from ALL 10 pick slots, first N to finish win a
 * Jackpot seat.
 *
 * A user's "pick slot" is their position (1–10) in the randomized draft order,
 * which does not exist until AFTER a draft fills — so crediting hooks the same
 * two places as Match Your Pick: reveal-complete (primary) and the
 * refresh-draft close backstop. NEVER the fill webhook (the order isn't there
 * yet — the Pick-10 bug on draft 1382).
 *
 * Collections
 *   v2_users/{uid}/promos/around-the-banana   per-user promo doc: atbSlotsHit,
 *                                             atbSeenDraftIds (idempotency),
 *                                             atbCompletedAt / atbWonAt
 *   around_the_banana/state                   the ONE race doc: winners[] —
 *                                             its length IS the seats-claimed
 *                                             count, appended in the same
 *                                             transaction that flips a user to
 *                                             10/10, so two users completing
 *                                             simultaneously can never both
 *                                             take seat #10.
 *
 * ROUND THREE relaunched 2026-08-17 (Boris): 'around-the-banana' back in
 * VISIBLE_PROMO_TYPES_ORDER + featured, cap 30, every racer reset to 0/10 by
 * scripts/_reset-atb-round3.mjs (winners' atbWonAt/atbSeatNumber kept, seen
 * ledger kept). Round-three seats fill queue round 14 (source 'atb', the
 * repurposed ex-vault lobby 2025-slow-draft-50, Go Source flipped to 'promo').
 *
 * ⚠️ Two switches must BOTH be on for the promo to be live:
 *   1. Set ATB_START_MS below to the launch timestamp.
 *   2. Move 'around-the-banana' from ADMIN_PREVIEW_PROMO_TYPES into
 *      VISIBLE_PROMO_TYPES_ORDER (lib/promoFilter.ts).
 * Until both: the card is admin-preview-only and recordAroundTheBanana
 * no-ops, so nothing accrues and no seat can be awarded.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { unlockBadge } from '@/lib/db';
import { VISIBLE_PROMO_TYPES } from '@/lib/promoFilter';
import { pushStreamEventBg } from '@/lib/userEventStream';
import type { Promo } from '@/types';

export const ATB_PROMO_ID = 'around-the-banana';
/** First N players to cover all 10 slots win. Richard's opener: 10. */
export const ATB_SEATS_TOTAL = 10;
/** Total seat cap across ALL rounds. Round one = winners 1-10 (nine drafted
 *  in Jackpot #41, MobySlick's seat honored in the wheel lobby); round two =
 *  winners 11-20 (ATB-only lobby, Jackpot #47); round THREE = winners 21-30
 *  (Boris 2026-08-17 relaunch: same promo, fresh 0/10 lap for everyone, one
 *  more ATB-only lobby). At the cap the promo is done. NOT a lifetime per-user
 *  cap — prior-round winners can win AGAIN (Richard 2026-08-14); the repeat
 *  guard in recordAroundTheBanana is round-scoped. Rounds are ATB_SEATS_TOTAL
 *  seats each: round N = winners (N-1)*10+1 .. N*10. */
export const ATB_TOTAL_WINNER_CAP = Number.POSITIVE_INFINITY;
// ↑ Boris 2026-08-17: the promo LOOPS — when a round's 10th seat is won the
// lobby fills (Go starts the slow draft), every lap resets to 0/10 and the next
// round opens with a fresh ATB-only lobby at its first win. Set a finite number
// here to end the campaign at that seat (e.g. 40 = stop after round four).
/**
 * Drafts revealed before this never count — the race starts fresh at launch,
 * it is NOT a lookup of who already happens to hold all 10 slots historically.
 * LAUNCHED 2026-08-11 ~3:10pm PT (Richard's green light, same session as the
 * build). null would put the promo back to fully dormant.
 */
export const ATB_START_MS: number | null = 1786486211000;
/** Idempotency ledger cap per user — same shape as Match Your Pick. */
const ATB_SEEN_LEDGER_MAX = 120;

const STATE_COLLECTION = 'around_the_banana';
const STATE_DOC = 'state';

export interface AtbWinner {
  userId: string;
  /** 1-indexed order of completion — seat #1 finished first. */
  seat: number;
  at: string;
  /** Flipped true once the Jackpot pass is minted + queued. */
  seatGranted: boolean;
}

export function atbActive(now: number = Date.now()): boolean {
  return ATB_START_MS !== null
    && now >= ATB_START_MS
    && VISIBLE_PROMO_TYPES.has('around-the-banana');
}

/** {claimed, total} for the card — the Banana Draw seat-counter shape. */
export async function getAtbSeatCount(): Promise<{ claimed: number; total: number }> {
  if (!isFirestoreConfigured()) return { claimed: 0, total: ATB_SEATS_TOTAL };
  const snap = await getAdminFirestore().collection(STATE_COLLECTION).doc(STATE_DOC).get();
  const winners = (snap.data()?.winners ?? []) as AtbWinner[];
  // Round-relative counter (Boris 2026-08-12, rev 2): every round starts from
  // a CLEAN 0/10 — 20 winners = round three at 0/10, 30 = done at 10/10.
  const claimed = winners.length >= ATB_TOTAL_WINNER_CAP
    ? ATB_SEATS_TOTAL
    : winners.length % ATB_SEATS_TOTAL;
  return { claimed, total: ATB_SEATS_TOTAL };
}

/**
 * Round rollover reset: the moment a round's 10th seat is taken (winner
 * #10, #20, #30, …) EVERY racer's lap goes back to 0/10 — the next round is a
 * fresh race. Clears atbSlotsHit / progressCurrent and atbCompletedAt /
 * atbCompletedDraftName for everyone INCLUDING the round's winners (winners
 * CAN win again next round — Richard 2026-08-14; the 8/13 lobby-two reset
 * kept winners' completedAt and silently blocked them, fixed by backfill).
 * Deliberately KEEPS atbSeenDraftIds (old drafts must never re-credit slots
 * into the new race) and every winner's atbWonAt/atbSeatNumber (their card
 * keeps "Won Seat N" beside the fresh lap). Marker-guarded per completed seat
 * on the state doc (`lapResetAtSeat_30` …) — runs once per rollover.
 * History: seat 10 → `lobbyTwoResetAt` (8/13); seat 20 → `lobbyThreeResetAt`
 * (scripts/_reset-atb-round3.mjs, 8/17 relaunch); seat 30+ → this, automatic.
 */
export async function resetAllLapsForNextRound(completedSeat: number): Promise<void> {
  const db = getAdminFirestore();
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);
  const marker = `lapResetAtSeat_${completedSeat}`;
  const claimed = await db.runTransaction(async (tx) => {
    const s = (await tx.get(stateRef)).data() ?? {};
    if (s[marker]) return false;
    tx.set(stateRef, { [marker]: new Date().toISOString() }, { merge: true });
    return true;
  });
  if (!claimed) return;

  const snap = await db.collectionGroup('promos').get();
  let cleared = 0;
  for (const d of snap.docs) {
    if (d.id !== ATB_PROMO_ID) continue;
    const data = d.data();
    const mc = (data.modalContent ?? {}) as Record<string, unknown>;
    const hasProgress = Array.isArray(mc.atbSlotsHit) && (mc.atbSlotsHit as number[]).length > 0;
    if (!hasProgress && !mc.atbCompletedAt && !(Number(data.progressCurrent) > 0)) continue;
    await d.ref.update({
      progressCurrent: 0,
      'modalContent.atbSlotsHit': [],
      'modalContent.atbCompletedAt': FieldValue.delete(),
      'modalContent.atbCompletedDraftName': FieldValue.delete(),
    }).catch((err) =>
      logger.warn('atb.round_reset_doc_failed', { doc: d.ref.path, err: String(err) }));
    cleared++;
  }
  logger.info('atb.round_reset_done', { completedSeat, cleared });
}

export async function getAtbWinners(): Promise<AtbWinner[]> {
  if (!isFirestoreConfigured()) return [];
  const snap = await getAdminFirestore().collection(STATE_COLLECTION).doc(STATE_DOC).get();
  return (snap.data()?.winners ?? []) as AtbWinner[];
}

/**
 * Credit one revealed draft slot toward a user's lap Around The Banana.
 * Called from reveal-complete + refresh-draft for EVERY human seat with that
 * seat's slot (1–10). Idempotent per (user, draftId) via a capped seen-ledger.
 * PAID drafts only (Boris 2026-08-22 — every promo is paid-gated; free
 * counted at launch per Richard 2026-08-11). Bots have no promo docs, so they
 * no-op naturally; callers also pre-exclude bots.
 *
 * The 10/10 completion and the winners[] append happen in ONE transaction on
 * both docs — the first ATB_SEATS_TOTAL completers take the seats, everyone
 * after gets atbCompletedAt with no seat ("made it around, seats were gone").
 */
export async function recordAroundTheBanana(
  userId: string,
  draftId: string,
  draftName: string,
  slot: number,
  opts?: { skipPaidGate?: boolean },
): Promise<void> {
  if (!atbActive()) return;
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) return;
  // PAID drafts only (Boris 2026-08-22) — the same shared gate daily-drafts /
  // pick-10 / pick-chase use, so every promo flips together. Admin grants pass
  // skipPaidGate: their synthetic draftIds have no pass stamp and no roster,
  // so the gate would (correctly) deny them.
  if (!opts?.skipPaidGate) {
    const { promoCreditAllowed } = await import('@/lib/db-firestore');
    if (!(await promoCreditAllowed(userId, draftId, undefined, 'around-the-banana'))) return;
  }

  const db = getAdminFirestore();
  const promoRef = db.collection('v2_users').doc(userId)
    .collection('promos').doc(ATB_PROMO_ID);
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);

  const result = await db.runTransaction(async (tx) => {
    const [promoSnap, stateSnap] = await Promise.all([tx.get(promoRef), tx.get(stateRef)]);
    if (!promoSnap.exists) return { changed: false, wonSeat: 0 }; // bot / never seeded
    const promo = promoSnap.data() as Promo;
    if (promo.type !== 'around-the-banana') return { changed: false, wonSeat: 0 };

    const mc = (promo.modalContent || {}) as Record<string, unknown>;
    const seen = (mc.atbSeenDraftIds as string[] | undefined) || [];
    if (seen.includes(draftId)) return { changed: false, wonSeat: 0 };

    const slotsHit = new Set((mc.atbSlotsHit as number[] | undefined) || []);
    const newSlot = !slotsHit.has(slot);
    slotsHit.add(slot);
    const sorted = Array.from(slotsHit).sort((a, b) => a - b);
    const nowIso = new Date().toISOString();

    let wonSeat = 0;
    const update: Record<string, unknown> = {
      progressCurrent: sorted.length,
      updatedAt: nowIso,
      modalContent: {
        atbSlotsHit: sorted,
        atbSeenDraftIds: [...seen, draftId].slice(-ATB_SEEN_LEDGER_MAX),
      },
    };

    if (sorted.length === 10 && !mc.atbCompletedAt) {
      (update.modalContent as Record<string, unknown>).atbCompletedAt = nowIso;
      (update.modalContent as Record<string, unknown>).atbCompletedDraftName = draftName;
      const winners = (stateSnap.data()?.winners ?? []) as AtbWinner[];
      // Repeat guard is ROUND-scoped (Richard 2026-08-14): a prior-round
      // winner CAN take a seat in the current round — only a seat already won
      // in the CURRENT round blocks. Round N floor = (N-1)*10 + 1.
      const roundFloorSeat = Math.floor(winners.length / ATB_SEATS_TOTAL) * ATB_SEATS_TOTAL + 1;
      const alreadyWon = winners.some((w) => w.userId === userId && w.seat >= roundFloorSeat);
      if (!alreadyWon && winners.length < ATB_TOTAL_WINNER_CAP) {
        wonSeat = winners.length + 1;
        (update.modalContent as Record<string, unknown>).atbWonAt = nowIso;
        // Display seat is lobby-relative: winner #11 = seat 1 of lobby two,
        // winner #21 = seat 1 of lobby three.
        (update.modalContent as Record<string, unknown>).atbSeatNumber = ((wonSeat - 1) % ATB_SEATS_TOTAL) + 1;
        tx.set(stateRef, {
          winners: FieldValue.arrayUnion({
            userId, seat: wonSeat, at: nowIso, seatGranted: false,
          } satisfies AtbWinner),
        }, { merge: true });
      }
    }

    tx.set(promoRef, update, { merge: true });
    return { changed: true, wonSeat, newSlot };
  });

  if (result.wonSeat > 0) {
    // A winner without a seat is the worst failure this promo can have —
    // awaited (not backgrounded) so the caller's request keeps the lambda
    // alive through the mint, and any failure logs loud with the winner
    // already durably recorded in winners[] for a hand re-run.
    await awardAtbSeat(userId, result.wonSeat)
      .catch((err) => logger.error('atb.seat_failed', { userId, seat: result.wonSeat, err: String(err) }));
    // A round's 10th seat (winner #10, #20, #30, …) fills the ATB-only lobby
    // (Go starts the slow draft at 10/10) — the very moment they're seated,
    // EVERY racer's lap resets to 0/10 and the next round is on (Boris
    // 2026-08-17: the promo loops). Awaited + marker-guarded per rollover.
    // Seats 10 and 20 were already handled (markers lobbyTwoResetAt /
    // lobbyThreeResetAt) — the guard below only fires for seat 30 onward.
    if (result.wonSeat % ATB_SEATS_TOTAL === 0 && result.wonSeat > 20) {
      await resetAllLapsForNextRound(result.wonSeat)
        .catch((err) => logger.error('atb.round_reset_failed', { seat: result.wonSeat, err: String(err) }));
    }
    pushStreamEventBg(userId, 'promo-around-the-banana', {
      draftId, slot, seatNumber: result.wonSeat, source: 'around-the-banana',
    });
  } else if (result.changed) {
    // Silent refetch ping (no bell) so the card's slot grid updates the
    // instant a reveal lands a new slot — same nudge Match Your Pick uses.
    pushStreamEventBg(userId, 'notification', { draftId });
  }
}

/**
 * Seat the winner in the promo Jackpot round. Lifted from THE DROP's
 * awardSpecialSeat (lib/dropRun.ts) unchanged in substance: mint a real
 * Jackpot pass, stamp its Level so the Go engine never spends it on an
 * ordinary draft, and queue it with source 'promo' (never the wheel-winners'
 * round — the roarstone incident, Richard 2026-07-30).
 */
async function awardAtbSeat(winnerId: string, seat: number): Promise<void> {
  const db = getAdminFirestore();
  let seated = false;

  const { isAdminMintConfigured, reserveTokensToWallet } = await import('@/lib/onchain/adminMint');
  if (isAdminMintConfigured()) {
    try {
      const res = await reserveTokensToWallet({ to: winnerId, count: 1 });
      const { recordPassOrigins } = await import('@/lib/onchain/passOrigin');
      // Free-origin keeps the won seat out of the PAID revenue count.
      await recordPassOrigins({
        tokenIds: res.tokenIds, origin: 'admin_grant', ownerAtMint: winnerId,
        txHash: res.txHash, reason: `around-the-banana:seat-${seat}`, level: 'jackpot',
      });
      const { registerMintedTokens } = await import('@/lib/onchain/reconcilePasses');
      await registerMintedTokens(winnerId, res.tokenIds, 'free')
        .catch((e) => logger.warn('atb.register_go_failed', { winnerId, err: (e as Error).message }));

      // Stamp the special level so selectTokensByType / countSpendableTokens
      // SKIP it — without this the pass could be spent on an ordinary draft,
      // burning the Jackpot seat.
      await Promise.all(res.tokenIds.map((tid) => db
        .collection('owners').doc(winnerId.toLowerCase())
        .collection('validDraftTokens').doc(String(tid))
        .set({ Level: 'Jackpot' }, { merge: true })));

      const tokenId = res.tokenIds[0];
      if (tokenId) {
        const { joinQueueWithToken } = await import('@/lib/db');
        const { joinedRoundId } = await joinQueueWithToken(winnerId, 'jackpot', String(tokenId), seat >= 11 ? 'atb' : 'promo');
        if (joinedRoundId !== null) {
          const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
          await ensureSpecialDraftSeat('jackpot', joinedRoundId, winnerId);
        }
        seated = true;
        logger.info('atb.seated_with_token', { winnerId, seat, tokenId, round: joinedRoundId });
      }
    } catch (mintErr) {
      logger.error('atb.mint_failed', { winnerId, seat, err: (mintErr as Error).message });
    }
  }

  // FALLBACK — mint unavailable or failed. A seat that can't be sold still
  // beats no seat. Credit jackpotEntries HERE ONLY (crediting on both paths
  // would seat the winner twice — the Drop's hard-won rule).
  if (!seated) {
    await db.collection('v2_users').doc(winnerId)
      .set({ jackpotEntries: FieldValue.increment(1) }, { merge: true });
    const { joinQueue } = await import('@/lib/db');
    const { joinedRoundIds } = await joinQueue(winnerId, 'jackpot', seat >= 11 ? 'atb' : 'promo');
    const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
    for (const rid of joinedRoundIds) await ensureSpecialDraftSeat('jackpot', rid, winnerId);
    logger.warn('atb.seated_legacy_no_token', { winnerId, seat, rounds: joinedRoundIds });
  }

  // Mark the winner record granted — the recon signal that no one is owed.
  await db.runTransaction(async (tx) => {
    const ref = db.collection(STATE_COLLECTION).doc(STATE_DOC);
    const winners = ((await tx.get(ref)).data()?.winners ?? []) as AtbWinner[];
    tx.set(ref, {
      winners: winners.map((w) => (w.userId === winnerId ? { ...w, seatGranted: true } : w)),
    }, { merge: true });
  }).catch((err) => logger.warn('atb.grant_mark_failed', { winnerId, err: String(err) }));

  await unlockBadge(winnerId, 'jackpot-club', { source: 'around-the-banana', seat })
    .catch((err) => logger.warn('atb.badge_failed', { winnerId, err: String(err) }));
}
