/**
 * THE DROP — payout and schedule.
 *
 * ⚠️ SINGLE SOURCE OF TRUTH for what a pack actually pays. The Eliminator put
 * its prize logic in the cron route only, so when the client gained the ability
 * to trigger a burn it would have eliminated players with no notification and
 * never awarded the JackHOF seat. Every path here — a user opening one pack,
 * open-all, and the midnight auto-open — settles through `settlePrizes`.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';
import { ensureNight, lockNight, openPacks, type OpenedPack } from '@/lib/drop';
import { nightFor, nightFromId, revealNightIdFor } from '@/lib/dropMath';
import { unlockBadge } from '@/lib/db';
import { isAdminMintConfigured, reserveTokensToWallet } from '@/lib/onchain/adminMint';
import { recordPassOrigins } from '@/lib/onchain/passOrigin';
import { registerMintedTokens } from '@/lib/onchain/reconcilePasses';

/**
 * Pay out everything a set of opened packs contains.
 *
 * Idempotent by construction: a pack can only be opened once (the `opened` flag
 * flips in a transaction inside openPacks), so this is only ever reached with
 * packs that were sealed a moment ago.
 */
export async function settlePrizes(
  userId: string, nightId: string, opened: OpenedPack[],
): Promise<{ spins: number; seat: boolean; hofSeat: boolean }> {
  const db = getAdminFirestore();
  const uid = userId.toLowerCase();
  const spins = opened.reduce((s, o) => s + (o.prize.kind === 'spins' ? (o.prize.spins ?? 0) : 0), 0);
  const seat = opened.some((o) => o.prize.kind === 'jackhof');
  const hofSeat = opened.some((o) => o.prize.kind === 'hof');

  if (spins > 0) {
    // wheelSpins is the promo-spin counter the wheel already consumes — the
    // same field every other promo credits.
    await db.collection('v2_users').doc(uid)
      .set({ wheelSpins: FieldValue.increment(spins) }, { merge: true });
    await createNotification(uid, {
      type: 'promo',
      title: `You pulled ${spins} spin${spins === 1 ? '' : 's'}`,
      message: 'Your spins are waiting on the Banana Wheel.',
      link: '/banana-wheel',
      dedupeKey: `drop-spins-${nightId}-${uid}`,
      icon: 'ticket',
    }).catch(() => { /* best-effort */ });
  }

  if (seat) {
    await awardSpecialSeat(uid, nightId, 'jackhof');
    await createNotification(uid, {
      type: 'promo',
      title: 'JACKHOF SEAT',
      message: 'Your pack had the seat in it. Tap to take your place in the JackHOF draft.',
      link: '/promos?promo=drop',
      dedupeKey: `drop-seat-${nightId}`,
      icon: 'award',
    }).catch(() => { /* best-effort */ });
    logger.info('drop.seat.awarded', { nightId, userId: uid });
  }

  if (hofSeat) {
    await awardSpecialSeat(uid, nightId, 'hof');
    await createNotification(uid, {
      type: 'promo',
      title: 'HOF SEAT',
      message: 'Your pack had a Hall of Fame seat in it. Tap to take your place.',
      link: '/promos?promo=drop',
      dedupeKey: `drop-hof-${nightId}`,
      icon: 'award',
    }).catch(() => { /* best-effort */ });
    logger.info('drop.hof.awarded', { nightId, userId: uid });
  }

  return { spins, seat, hofSeat };
}

/** Open packs and pay them out in one call. Used by every open path. */
export async function openAndSettle(opts: {
  userId: string; nightId: string; packIds?: string[]; auto?: boolean;
}): Promise<{ ok: boolean; reason?: string; opened: OpenedPack[]; spins: number; seat: boolean; hofSeat: boolean }> {
  const res = await openPacks(opts);
  if (!res.ok || res.opened.length === 0) {
    return { ...res, spins: 0, seat: false, hofSeat: false };
  }
  const paid = await settlePrizes(opts.userId, opts.nightId, res.opened);
  return { ...res, ...paid };
}

/** How long after the 8pm lock the "go open them" nudge fires. 1h leaves a
 *  clear 3-hour runway before the midnight auto-open. */
const REMINDER_AFTER_LOCK_MS = 60 * 60 * 1000;

/**
 * Ping everyone still holding a sealed pack for this night.
 *
 * Idempotent per (night, wallet): the dedupeKey is the night, and
 * createNotification writes dedupe-keyed bells with `.create()` — so the cron
 * re-running every minute for the rest of the night can only ever send once.
 * Someone who opens after the nudge simply doesn't get a second one.
 */
async function remindSealedHolders(nightId: string): Promise<{ users: number }> {
  const db = getAdminFirestore();
  const sealed = await db.collection('drop_nights').doc(nightId)
    .collection('packs').where('opened', '==', false).get();

  const counts = new Map<string, number>();
  for (const d of sealed.docs) {
    const p = d.data() as { userId: string };
    const uid = String(p.userId).toLowerCase();
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  if (counts.size === 0) return { users: 0 };

  await Promise.allSettled([...counts].map(([uid, n]) => createNotification(uid, {
    type: 'promo',
    title: `Open your pack${n === 1 ? '' : 's'}`,
    message: `You still have ${n} sealed pack${n === 1 ? '' : 's'} from tonight's Drop. `
      + `Open ${n === 1 ? 'it' : 'them'} to see what's inside — at midnight PT `
      + `${n === 1 ? 'it opens' : 'they open'} automatically.`,
    link: '/promos?promo=drop',
    dedupeKey: `drop-open-reminder-${nightId}`,
    icon: 'ticket',
  })));

  logger.info('drop.reminder.sent', { nightId, users: counts.size, packs: sealed.size });
  return { users: counts.size };
}

/**
 * Lock the night at 8pm if it's due, nudge sealed holders an hour later, and
 * auto-open anything still sealed at midnight. Safe to call on any tick —
 * every step no-ops when not due.
 */
export async function runDropSchedule(now = Date.now()): Promise<Record<string, unknown>> {
  if (!isFirestoreConfigured()) return { ok: false, reason: 'no-firestore' };
  const db = getAdminFirestore();
  await ensureNight(now);

  // The night that should be locking is the one whose 8pm has passed — which,
  // once 8pm rolls the id forward, is YESTERDAY's id.
  // ⚠️ The night to lock is the one being REVEALED — revealNightIdFor(), which
  // does not roll at 8pm.
  //
  // This used to derive it by subtracting a day from tomorrow's locksAt and
  // running that back through nightFor(). That timestamp lands EXACTLY on an
  // 8pm boundary, where nightIdFor() rolls forward — so both candidates came
  // back as tomorrow and tonight was never a candidate at all. The 8pm lock
  // silently did nothing; it had to be fired by hand on launch night
  // (2026-08-02, ~2 min late). An off-by-one that could only ever appear at
  // the one instant the whole promo depends on.
  // Yesterday's night stays a candidate too: its midnight auto-open sweep is
  // due at exactly the instant the reveal night rolls over, so keying only off
  // "now" drops it one second before its sweep and strands every sealed pack.
  const today = nightFor(now);
  const candidates = [
    revealNightIdFor(now - 24 * 3600_000),
    revealNightIdFor(now),
    today.nightId,
  ];

  const out: Record<string, unknown> = {};
  for (const nightId of [...new Set(candidates)]) {
    const ref = db.collection('drop_nights').doc(nightId);
    const doc = (await ref.get()).data() as { status?: string; autoOpensAt?: number } | undefined;
    if (!doc) continue;

    if (doc.status === 'earning' && now >= nightFromId(nightId).locksAt) {
      out[`lock:${nightId}`] = await lockNight(nightId, now);
    }

    // Nightly nudge — the packs are open, go look. Fires once per night, some
    // hours before the midnight sweep, to EVERY holder still sealed.
    //
    // ⚠️ Everyone sealed, never just the winners: only-winners would make the
    // bell itself the result, spoiling the reveal for the people it's meant to
    // reward (Boris 2026-08-02). The copy stays neutral for the same reason.
    const nudgeAt = nightFromId(nightId).locksAt + REMINDER_AFTER_LOCK_MS;
    if (now >= nudgeAt && now < nightFromId(nightId).autoOpensAt) {
      out[`remind:${nightId}`] = await remindSealedHolders(nightId);
    }

    // Midnight sweep — nobody loses what they earned for being asleep.
    const fresh = (await ref.get()).data() as { status?: string } | undefined;
    if (fresh?.status === 'locked' && now >= nightFromId(nightId).autoOpensAt) {
      const sealed = await ref.collection('packs').where('opened', '==', false).get();
      const byUser = new Map<string, string[]>();
      for (const d of sealed.docs) {
        const p = d.data() as { userId: string; packId: string };
        byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p.packId]);
      }
      let users = 0;
      for (const [uid, packIds] of byUser) {
        await openAndSettle({ userId: uid, nightId, packIds, auto: true }).catch((e) => {
          logger.warn('drop.autoopen.failed', { nightId, uid, err: String(e) });
        });
        users += 1;
      }
      await ref.set({ status: 'settled' }, { merge: true });
      out[`autoOpen:${nightId}`] = { users, packs: sealed.size };
      logger.info('drop.night.settled', { nightId, users, packs: sealed.size });
    }
  }
  return { ok: true, ...out };
}

/**
 * Seat the winner in the PROMO JackHOF round — the league the Banana Draw left
 * at 5/10 and the Eliminator carried to 8/10.
 *
 * Lifted from the Eliminator unchanged in substance. The preferred path mints a
 * real JackHOF pass NFT and binds the seat to it, which is what makes the seat
 * behave like a pass: it shows under their passes with the JackHOF level and
 * stays SELLABLE until the league fills.
 *
 * ⚠️ Both steps are required. Crediting jackhofEntries alone leaves the winner
 * with a number on their user doc and NO seat — nothing else in the app calls
 * joinQueue for them.
 */
async function awardSpecialSeat(
  winnerId: string, nightId: string, type: 'jackhof' | 'hof',
): Promise<void> {
  const db = getAdminFirestore();
  let seated = false;

  if (isAdminMintConfigured()) {
    try {
      const res = await reserveTokensToWallet({ to: winnerId, count: 1 });
      // Free-origin: a won seat cost nothing, and pass_origin is what keeps it
      // out of the PAID revenue count.
      await recordPassOrigins({
        tokenIds: res.tokenIds, origin: 'admin_grant', ownerAtMint: winnerId,
        txHash: res.txHash, reason: `drop:${nightId}`, level: type,
      });
      await registerMintedTokens(winnerId, res.tokenIds, 'free')
        .catch((e) => logger.warn('drop.register_go_failed', { nightId, err: (e as Error).message }));

      // Stamp the special level so the Go engine's selectTokensByType and
      // countSpendableTokens both SKIP it — without this the pass could be
      // spent on an ordinary draft, burning the JackHOF seat.
      await Promise.all(res.tokenIds.map((tid) => db
        .collection('owners').doc(winnerId.toLowerCase())
        .collection('validDraftTokens').doc(String(tid))
        .set({ Level: type === 'jackhof' ? 'JackHOF' : 'HOF' }, { merge: true })));

      const tokenId = res.tokenIds[0];
      if (tokenId) {
        const { joinQueueWithToken } = await import('@/lib/db');
        // 'promo' keeps drop winners in the promo round — a wheel winner must
        // never be seated into the giveaway draft (Richard 2026-07-30, after
        // roarstone landed in it and had to be moved out by hand).
        const { joinedRoundId } = await joinQueueWithToken(winnerId, type, String(tokenId), 'promo');
        if (joinedRoundId !== null) {
          const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
          await ensureSpecialDraftSeat(type, joinedRoundId, winnerId);
        }
        seated = true;
        logger.info('drop.seated_with_token', { nightId, winnerId, tokenId, round: joinedRoundId });
      }
    } catch (mintErr) {
      logger.error('drop.mint_failed', { nightId, winnerId, err: (mintErr as Error).message });
    }
  }

  // FALLBACK — mint unavailable or failed. A seat that can't be sold still
  // beats no seat, so a winner never walks away empty.
  if (!seated) {
    try {
      await db.collection('v2_users').doc(winnerId)
        .set({ [type === 'jackhof' ? 'jackhofEntries' : 'hofEntries']: FieldValue.increment(1) }, { merge: true });
      const { joinQueue } = await import('@/lib/db');
      const { joinedRoundIds } = await joinQueue(winnerId, type, 'promo');
      const { ensureSpecialDraftSeat } = await import('@/lib/specialDraft');
      for (const rid of joinedRoundIds) await ensureSpecialDraftSeat(type, rid, winnerId);
      logger.warn('drop.seated_legacy_no_token', { nightId, winnerId, rounds: joinedRoundIds });
    } catch (qErr) {
      // Loud: a winner without a seat is the worst failure this promo can have.
      logger.error('drop.seat_failed', { nightId, winnerId, err: (qErr as Error).message });
    }
  }

  if (type === 'jackhof') {
    await unlockBadge(winnerId, 'jackhof-club', { source: 'drop', nightId })
      .catch((err) => logger.warn('drop.badge_failed', { nightId, winnerId, err: String(err) }));
  }
}
