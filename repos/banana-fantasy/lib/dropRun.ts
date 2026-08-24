/**
 * THE DROP — payout and schedule.
 *
 * ⚠️ SINGLE SOURCE OF TRUTH for what a pack actually pays. The Eliminator put
 * its prize logic in the cron route only, so when the client gained the ability
 * to trigger a burn it would have eliminated players with no notification and
 * never awarded the JackHOF seat. Every path here — a user opening one pack or
 * open-all, tonight's or a previous night's — settles through `settlePrizes`.
 *
 * ⚠️ There is NO auto-open. Packs stay sealed until the owner rips them —
 * Richard removed the midnight sweep 2026-08-03 ("no backstop window at all").
 * A prize is credited only when its pack opens; an absent owner's prize just
 * waits, including a seat. That's accepted, not an oversight.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { createNotification } from '@/lib/queueNotifications';
import { logger } from '@/lib/logger';
import { ensureNight, lockNight, openPacks, type OpenedPack } from '@/lib/drop';
import { nightFor, nightFromId, revealNightIdFor } from '@/lib/dropMath';
import { prizeSummaryLine } from '@/lib/dropRates';
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
): Promise<{ spins: number; seat: boolean; hofSeat: boolean; jackpotSeat: boolean }> {
  const db = getAdminFirestore();
  const uid = userId.toLowerCase();
  const spins = opened.reduce((s, o) => s + (o.prize.kind === 'spins' ? (o.prize.spins ?? 0) : 0), 0);
  const seat = opened.some((o) => o.prize.kind === 'jackhof');
  const hofSeat = opened.some((o) => o.prize.kind === 'hof');
  const jackpotSeat = opened.some((o) => o.prize.kind === 'jackpot');

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

  if (jackpotSeat) {
    await awardSpecialSeat(uid, nightId, 'jackpot');
    await createNotification(uid, {
      type: 'promo',
      title: 'JACKPOT SEAT',
      message: 'Your pack had a Jackpot seat in it. Tap to take your place.',
      link: '/promos?promo=drop',
      dedupeKey: `drop-jackpot-${nightId}`,
      icon: 'award',
    }).catch(() => { /* best-effort */ });
    logger.info('drop.jackpot.awarded', { nightId, userId: uid });
  }

  return { spins, seat, hofSeat, jackpotSeat };
}

/** Open packs and pay them out in one call. Used by every open path. */
export async function openAndSettle(opts: {
  userId: string; nightId: string; packIds?: string[]; auto?: boolean;
}): Promise<{ ok: boolean; reason?: string; opened: OpenedPack[]; spins: number; seat: boolean; hofSeat: boolean; jackpotSeat: boolean }> {
  const res = await openPacks(opts);
  if (!res.ok || res.opened.length === 0) {
    return { ...res, spins: 0, seat: false, hofSeat: false, jackpotSeat: false };
  }
  const paid = await settlePrizes(opts.userId, opts.nightId, res.opened);
  return { ...res, ...paid };
}

/** The 6pm PT heads-up — 2 hours before the night locks and opens. */
const PRE_DROP_REMINDER_BEFORE_LOCK_MS = 2 * 60 * 60 * 1000;
/** The "go open them" ping fires just after the 8pm lock — a few minutes so
 *  the lock transaction and prize writes are done before anyone taps through. */
const REMINDER_AFTER_LOCK_MS = 5 * 60 * 1000;
/** How long past lock either ping may still send. Purely a send-window bound
 *  (dedupe already makes each one once-ever) so a night that slipped through
 *  never gets pinged days later. */
const REMINDER_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Count each holder's sealed packs for a night. */
async function sealedCountsByHolder(nightId: string): Promise<Map<string, number>> {
  const db = getAdminFirestore();
  const sealed = await db.collection('drop_nights').doc(nightId)
    .collection('packs').where('opened', '==', false).get();
  const counts = new Map<string, number>();
  for (const d of sealed.docs) {
    const p = d.data() as { userId: string };
    const uid = String(p.userId).toLowerCase();
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  return counts;
}

/**
 * 6pm PT ping — 2 hours out, to everyone already holding packs for tonight:
 * what's in the pool (built from the night's ACTUAL prizes, so one-night
 * boosts read correctly) and that there's still time to grow the stack.
 *
 * Idempotent per (night, wallet): the dedupeKey is the night, and
 * createNotification writes dedupe-keyed bells with `.create()` — so the cron
 * re-running every tick for the rest of the window can only ever send once.
 */
async function remindPreDrop(nightId: string): Promise<{ users: number }> {
  const counts = await sealedCountsByHolder(nightId);

  // ALL real users get the 2-hour ping (Boris 2026-08-07 — the holders-only
  // version skipped exactly the people who still need to earn packs, so a
  // manual all-users bell was being sent by hand every night). Holders get
  // their personal count; everyone else gets the earn motivator. House bots
  // (botWallets registry) are excluded — they hold packs for fingerprint
  // resistance but nobody reads their bells.
  const db = getAdminFirestore();
  const [usersSnap, botsSnap] = await Promise.all([
    db.collection('v2_users').select().get(),
    db.collection('botWallets').select().get(),
  ]);
  const bots = new Set(botsSnap.docs.map((d) => d.id.toLowerCase()));
  const prizes = prizeSummaryLine(nightId);

  const holderMsgs: Array<Promise<void>> = [];
  const earnWallets: string[] = [];
  for (const doc of usersSnap.docs) {
    const uid = doc.id.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(uid) || bots.has(uid)) continue;
    const n = counts.get(uid) ?? 0;
    if (n > 0) {
      holderMsgs.push(createNotification(uid, {
        type: 'promo',
        title: '⏰ 2 hours until THE DROP',
        message: `Tonight at 9:00 PM PT: ${prizes} — all guaranteed. `
          + `You hold ${n} sealed pack${n === 1 ? '' : 's'}. Every draft you fill before 9 adds more.`,
        link: '/promos?promo=drop',
        dedupeKey: `drop-2h-${nightId}`,
        icon: 'ticket',
      }));
    } else {
      earnWallets.push(uid);
    }
  }
  await Promise.allSettled(holderMsgs);
  if (earnWallets.length > 0) {
    const { createNotificationForWallets } = await import('@/lib/queueNotifications');
    await createNotificationForWallets(earnWallets, {
      type: 'promo',
      title: '⏰ 2 hours to earn your packs',
      message: `2 hours left to earn packs for tonight's Drop — win prizes including ${prizes}, all guaranteed. Do drafts. Earn packs. Win prizes.`,
      link: '/drop',
      dedupeKey: `drop-2h-${nightId}`,
      icon: 'ticket',
    });
  }

  const total = counts.size + earnWallets.length;
  logger.info('drop.prereminder.sent', { nightId, holders: counts.size, earners: earnWallets.length });
  return { users: total };
}

/**
 * The 8pm ping — the drop is live, go rip your packs. Same idempotence as
 * remindPreDrop. No deadline in the copy: packs never auto-open and never
 * expire, they wait until the owner opens them.
 */
async function remindSealedHolders(nightId: string): Promise<{ users: number }> {
  const counts = await sealedCountsByHolder(nightId);
  if (counts.size === 0) return { users: 0 };

  await Promise.allSettled([...counts].map(([uid, n]) => createNotification(uid, {
    type: 'promo',
    title: `Your pack${n === 1 ? ' is' : 's are'} ready — open ${n === 1 ? 'it' : 'them'}`,
    message: `Tonight's Drop is live. You have ${n} sealed pack${n === 1 ? '' : 's'} waiting — `
      + `open ${n === 1 ? 'it' : 'them'} to see what's inside. No rush: ${n === 1 ? 'it' : 'they'}'ll `
      + `wait for you as long as it takes.`,
    // Straight to the packs page — the bell says "open them", so the tap must
    // land where the packs ARE (Boris 2026-08-19), not on the promo card.
    link: '/drop',
    dedupeKey: `drop-open-reminder-${nightId}`,
    icon: 'ticket',
  })));

  logger.info('drop.reminder.sent', { nightId, users: counts.size });
  return { users: counts.size };
}

/**
 * Ping pack holders at 6pm, lock the night at 8pm if it's due, and ping again
 * right after the lock. Safe to call on any tick — every step no-ops when not
 * due. Deliberately NO auto-open sweep (removed 2026-08-03): sealed packs stay
 * sealed until their owner opens them, however long that takes.
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
  // Yesterday's night stays a candidate as a straddle backstop: a lock that
  // somehow missed its whole window still gets picked up on the next day's
  // ticks rather than stranding the night in 'earning'.
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

    const { locksAt } = nightFromId(nightId);

    // 6pm heads-up — two hours out, still earning. Window-bounded so a night
    // processed late (straddle candidate) can't ping days after the fact.
    // First automated night is 8/4: this shipped mid-window on 8/3, when the
    // "2 hours" claim was already stale and Boris had hand-blasted the sprint
    // push — firing would have double-pinged everyone. Guard is inert from 8/4
    // on; delete whenever.
    const preRemindLive = nightId > '2026-08-03';
    if (preRemindLive && doc.status === 'earning' && now >= locksAt - PRE_DROP_REMINDER_BEFORE_LOCK_MS && now < locksAt) {
      out[`preRemind:${nightId}`] = await remindPreDrop(nightId);
    }

    if (doc.status === 'earning' && now >= locksAt) {
      out[`lock:${nightId}`] = await lockNight(nightId, now);
    }

    // The 8pm ping — the packs are open, go look. Fires once per night, a few
    // minutes after the lock, to EVERY holder still sealed.
    //
    // ⚠️ Everyone sealed, never just the winners: only-winners would make the
    // bell itself the result, spoiling the reveal for the people it's meant to
    // reward (Boris 2026-08-02). The copy stays neutral for the same reason.
    const nudgeAt = locksAt + REMINDER_AFTER_LOCK_MS;
    if (now >= nudgeAt && now < locksAt + REMINDER_WINDOW_MS) {
      out[`remind:${nightId}`] = await remindSealedHolders(nightId);
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
// Exported for GOLDEN TICKETS (lib/zoneDrop): a Golden Ticket is a JackHOF
// seat and must settle through this exact path — mint, level stamp, promo
// round, seat — so zone winners behave identically to drop winners.
export async function awardSpecialSeat(
  winnerId: string, nightId: string, type: 'jackpot' | 'jackhof' | 'hof',
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
        .set({ Level: type === 'jackhof' ? 'JackHOF' : type === 'jackpot' ? 'Jackpot' : 'HOF' }, { merge: true })));

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
        .set({
          [type === 'jackhof' ? 'jackhofEntries' : type === 'jackpot' ? 'jackpotEntries' : 'hofEntries']:
            FieldValue.increment(1),
        }, { merge: true });
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
