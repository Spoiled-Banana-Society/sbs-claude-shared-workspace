/**
 * THE ELIMINATOR — execute any due burns and pay out.
 *
 * ⚠️ SINGLE SOURCE OF TRUTH for a burn's side effects. The burn itself lives in
 * executeBurn, but the pushes and the prizes used to live only in the cron
 * route — so anything else that called executeBurn would eliminate players with
 * no notification and, on the final burn, no JackHOF seat awarded. Both the
 * cron and the client-triggered tick call THIS, so the two paths cannot drift.
 *
 * Idempotent throughout: executeBurn claims each burn index in a transaction,
 * and every notification carries a per-(day, burn, user) dedupeKey. Safe to
 * call from many clients at the same instant — the first wins, the rest no-op.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';
import { ensureDay, executeBurn, pendingBurns, revealJackhofWinner } from '@/lib/eliminator';
import { SPINS_PER_RUNNER_UP, BANANAS_SURVIVE_HOUR, prevDayId } from '@/lib/eliminatorMath';
import { unlockBadge } from '@/lib/db';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';

export async function runDueBurns(now = Date.now()): Promise<{
  ok: boolean; dayId: string; burns: number; results: Array<Record<string, unknown>>;
}> {
  const day = await ensureDay(now);

  // YESTERDAY FIRST. dayIdFor rolls at 9pm sharp, which is the same instant the
  // final burn comes due — so from 21:00:00 "today" is tomorrow and the burn
  // that closes the day would be orphaned. Sweeping the previous day also heals
  // any burn the site slept through. pendingBurns no-ops on a missing or
  // already-closed day, so this costs one read when there's nothing to do.
  const results: Array<Record<string, unknown>> = [];
  for (const dayId of [prevDayId(day.dayId), day.dayId]) {
    results.push(...await runBurnsForDay(dayId, now));
  }
  return { ok: true, dayId: day.dayId, burns: results.length, results };
}

async function runBurnsForDay(dayId: string, now: number): Promise<Array<Record<string, unknown>>> {
  const due = await pendingBurns(dayId, now);
  if (due.length === 0) return [];

  const day = { dayId };
  const results: Array<Record<string, unknown>> = [];

  for (const burnIndex of due) {
    const outcome = await executeBurn(day.dayId, burnIndex, now);

    if (!outcome.ok) {
      // no-sealed-seed is the one worth shouting about: no wheel period is
      // active. We refuse to burn rather than fall back to a predictable
      // hash. The day stays open and the next tick retries.
      logger.error('eliminator.burn.failed', { dayId: day.dayId, burnIndex, reason: outcome.reason });
      results.push({ burnIndex, ok: false, reason: outcome.reason });
      continue;
    }
    if (outcome.reason === 'already-burned') {
      results.push({ burnIndex, ok: true, reason: 'already-burned' });
      continue;
    }

    // ── Pushes ────────────────────────────────────────────────────────
    // dedupeKey is per (day, burn, user) so a retried tick can never
    // double-ping anyone.
    if (!outcome.isFinal) {
      await Promise.allSettled(outcome.burned.map((uid) => createNotification(uid, {
        type: 'promo',
        title: 'You got burned',
        message: 'You kept every Banana. Enter a draft to get back on the list.',
        link: '/promos?promo=eliminator',
        dedupeKey: `eliminator-burned-${day.dayId}-${burnIndex}`,
        icon: 'ticket',
      })));
      await Promise.allSettled(outcome.survivors.map((uid) => createNotification(uid, {
        type: 'promo',
        title: 'You survived',
        message: `+${BANANAS_SURVIVE_HOUR} Bananas. ${outcome.burned.length} didn't make it.`,
        link: '/promos?promo=eliminator',
        dedupeKey: `eliminator-survived-${day.dayId}-${burnIndex}`,
        icon: 'award',
      })));
    }

    // ── Final burn: BEAT ONE only ─────────────────────────────────────
    // The five are locked here; the seat is drawn REVEAL_DELAY_MS later by
    // runDueReveal so "who made it" and "who won it" are separate moments.
    if (outcome.isFinal) {
      await Promise.allSettled(outcome.survivors.map((uid) => createNotification(uid, {
        type: 'promo',
        title: 'You made the final 5',
        message: 'Burning is done. The JackHOF seat is drawn in 5 minutes — your Bananas are your odds.',
        link: '/promos?promo=eliminator',
        dedupeKey: `eliminator-final5-${day.dayId}`,
        icon: 'award',
      })));
      logger.info('eliminator.final5.locked', { dayId: day.dayId, finalists: outcome.survivors });
    }

    results.push({
      burnIndex,
      ok: true,
      survivors: outcome.survivors.length,
      burned: outcome.burned.length,
      isFinal: outcome.isFinal,
    });
  }

  return results;
}

/**
 * BEAT TWO — draw the seat from the locked final five and pay everyone out.
 *
 * Runs on any tick once the reveal delay has elapsed. revealJackhofWinner
 * claims the winner in a transaction, so concurrent callers collapse to one
 * draw and this whole block runs exactly once.
 */
export async function runDueReveal(now = Date.now()): Promise<Record<string, unknown>> {
  const day = await ensureDay(now);
  // Same rollover trap as the burns, and worse here: the reveal is always due
  // AFTER the 9pm close, by which time dayIdFor has moved on. The seat is drawn
  // from yesterday's day doc every single night.
  for (const dayId of [prevDayId(day.dayId), day.dayId]) {
    const out = await revealForDay(dayId, now);
    if (out.revealed) return out;
  }
  return { revealed: false, reason: 'nothing-due' };
}

async function revealForDay(dayId: string, now: number): Promise<Record<string, unknown>> {
  const db = getAdminFirestore();
  const day = { dayId };
  const res = await revealJackhofWinner(day.dayId, now);
  if (!res.ok || res.reason === 'already-revealed') {
    return { revealed: false, reason: res.reason };
  }

  const winnerId = res.winnerId ?? null;
  const runnersUp = res.runnersUp ?? [];

  if (winnerId) {
    // Seats into the PROMO JackHOF round — the league the Banana Draw left
    // stranded at 5/10. Five nights of the Eliminator fill it to 10.
    await awardJackhofSeat(winnerId, day.dayId);
    await createNotification(winnerId, {
      type: 'promo',
      title: 'You won the JackHOF seat',
      message: 'Your Bananas came up. Tap to take your seat in the JackHOF draft.',
      link: '/promos?promo=eliminator',
      dedupeKey: `eliminator-win-${day.dayId}`,
      icon: 'award',
    }).catch(() => { /* best-effort */ });
  }

  await Promise.allSettled(runnersUp.map(async (uid) => {
    await db.collection('v2_users').doc(uid)
      .set({ wheelSpins: FieldValue.increment(SPINS_PER_RUNNER_UP) }, { merge: true });
    await createNotification(uid, {
      type: 'promo',
      title: `You made the final 5 — ${SPINS_PER_RUNNER_UP} spins`,
      message: 'The JackHOF seat went to another survivor. Your spins are waiting.',
      link: '/banana-wheel',
      dedupeKey: `eliminator-runnerup-${day.dayId}`,
      icon: 'ticket',
    }).catch(() => { /* best-effort */ });
  }));

  const players = await db.collection('eliminator_days').doc(day.dayId).collection('players').get();
  const others = players.docs.map((d) => d.id).filter((id) => id !== winnerId && !runnersUp.includes(id));
  await Promise.allSettled(others.map((uid) => createNotification(uid, {
    type: 'promo',
    title: "Tonight's JackHOF seat went out",
    message: 'The list resets in the morning — every draft you enter puts you back on.',
    link: '/promos?promo=eliminator',
    dedupeKey: `eliminator-result-${day.dayId}`,
    icon: 'ticket',
  })));

  logger.info('eliminator.day.complete', {
    dayId: day.dayId, winnerId, runnersUp: runnersUp.length, entrants: players.size,
  });
  return { revealed: true, winnerId, runnersUp: runnersUp.length, odds: res.odds };
}

/**
 * Seat the winner in a JackHOF draft.
 *
 * Lifted from the Banana Draw cron unchanged in substance — the preferred path
 * mints a REAL JackHOF pass NFT and binds the seat to it, which is what makes
 * the seat behave like a pass: it shows under their passes with the JackHOF
 * level (and the red-and-gold treatment), and stays SELLABLE until the league
 * fills.
 *
 * ⚠️ Both steps are required. Crediting jackhofEntries alone leaves the winner
 * with a number on their user doc and NO seat — nothing else in the app calls
 * joinQueue for them.
 */
async function awardJackhofSeat(winnerId: string, dayId: string): Promise<void> {
  const db = getAdminFirestore();
  let seated = false;

  if (isAdminMintConfigured()) {
    try {
      const res = await reserveTokensToWallet({ to: winnerId, count: 1 });
      // Free-origin: a won seat cost nothing, and pass_origin is what keeps it
      // out of the PAID revenue count (lib/onchain/reconcilePasses).
      await recordPassOrigins({
        tokenIds: res.tokenIds,
        origin: 'admin_grant',
        ownerAtMint: winnerId,
        txHash: res.txHash,
        reason: `eliminator:${dayId}`,
        level: 'jackhof',
      });
      await registerMintedTokens(winnerId, res.tokenIds, 'free')
        .catch((e) => logger.warn('eliminator.register_go_failed', { dayId, err: (e as Error).message }));

      // Stamp the special level so the Go engine's selectTokensByType and
      // countSpendableTokens both SKIP it — without this the pass could be
      // spent on an ordinary fast draft, burning the JackHOF seat.
      await Promise.all(res.tokenIds.map((tid) => db
        .collection('owners').doc(winnerId.toLowerCase())
        .collection('validDraftTokens').doc(String(tid))
        .set({ Level: 'JackHOF' }, { merge: true })));

      const tokenId = res.tokenIds[0];
      if (tokenId) {
        const { joinQueueWithToken } = await import('@/lib/db');
        // 'promo' keeps Eliminator winners in their OWN round — a wheel winner
        // who hit the 0.1% wedge must never be seated into the giveaway draft
        // (Richard 2026-07-30, after roarstone landed in it and had to be moved
        // out by hand). Wheel wins fill wheel rounds, promos fill promo rounds.
        const { joinedRoundId } = await joinQueueWithToken(winnerId, 'jackhof', String(tokenId), 'promo');
        if (joinedRoundId !== null) {
          const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
          await ensureSpecialDraftSeat('jackhof', joinedRoundId, winnerId);
        }
        seated = true;
        logger.info('eliminator.seated_with_token', { dayId, winnerId, tokenId, round: joinedRoundId });
      }
    } catch (mintErr) {
      logger.error('eliminator.mint_failed', { dayId, winnerId, err: (mintErr as Error).message });
    }
  }

  // FALLBACK — mint unavailable or failed. A seat that can't be sold still
  // beats no seat, so a winner never walks away empty. jackhofEntries is
  // credited HERE only: joinQueue consumes the counter, while the token path
  // doesn't use it, and crediting in both would leave a stale entry that could
  // seat them twice.
  if (!seated) {
    try {
      await db.collection('v2_users').doc(winnerId)
        .set({ jackhofEntries: FieldValue.increment(1) }, { merge: true });
      const { joinQueue } = await import('@/lib/db');
      const { joinedRoundIds } = await joinQueue(winnerId, 'jackhof', 'promo');
      const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
      for (const rid of joinedRoundIds) {
        await ensureSpecialDraftSeat('jackhof', rid, winnerId);
      }
      logger.warn('eliminator.seated_legacy_no_token', { dayId, winnerId, rounds: joinedRoundIds });
    } catch (qErr) {
      // Loud: a winner without a seat is the worst failure this promo can have.
      // The credit survives for manual recovery.
      logger.error('eliminator.seat_failed', { dayId, winnerId, err: (qErr as Error).message });
    }
  }

  await unlockBadge(winnerId, 'jackhof-club', { source: 'eliminator', dayId })
    .catch((err) => logger.warn('eliminator.badge_failed', { dayId, winnerId, err: String(err) }));
}
