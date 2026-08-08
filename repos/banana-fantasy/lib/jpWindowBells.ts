import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { replayJpLane, JP_TEN_SPIN_THROUGH, JP_FIVE_SPIN_THROUGH } from '@/lib/rollingLanes';
import { logger } from '@/lib/logger';

/**
 * Jackpot-window bells (Boris 2026-08-08) — the recurring all-user announce
 * loop for the Jackpot Hit promo, driven straight off the lane state:
 *
 *   • A Jackpot hits → window resets → EVERYONE gets one bell: "if the next
 *     Jackpot lands in the next N drafts, a paid drafter in it wins 10 Free
 *     Spins" (the 1–25 band of the new window).
 *   • The window reaches position 26 with no hit → one bell: same pitch at
 *     5 Free Spins (the 26–50 band).
 *   • Past 50 there is nothing to advertise (no bonus draw) — silence.
 *
 * Fires from the every-minute drop cron. Once-per-window-per-tier via a
 * jp_window_bells marker doc (create() gate), belt-and-suspenders per-user
 * dedupeKey underneath. The 10-spin bell additionally waits for the hit
 * draft's jackpot_draws doc so the announce can never beat the slot-machine
 * reveal (fill → reveal lag is minutes; the bell must not spoil the type).
 * Advertised draft counts are computed from the live filled count, so a bell
 * sent mid-band says the number that's actually left, never a stale "25".
 */
export async function runJpWindowBells(): Promise<Record<string, unknown>> {
  const db = getAdminFirestore();
  const tracker = (await db.collection('drafts').doc('draftTracker').get()).data() as {
    FilledLeaguesCount?: number;
    RollingStartDraft?: number;
    JackpotLeagueIds?: number[];
  } | undefined;
  const filled = Number(tracker?.FilledLeaguesCount ?? 0);
  const rollingStart = Number(tracker?.RollingStartDraft ?? 0);
  if (!tracker || rollingStart <= 0 || filled < rollingStart) return { ok: true, skip: 'not-rolling' };

  const jpIds = Array.isArray(tracker.JackpotLeagueIds) ? tracker.JackpotLeagueIds : [];
  const { windowStart } = replayJpLane(jpIds.map(Number), rollingStart, filled);
  const position = filled - windowStart + 1;

  // Which tier is live right now?
  let tier: 10 | 5 | null = null;
  if (position >= 1 && position <= JP_TEN_SPIN_THROUGH) tier = 10;
  else if (position <= JP_FIVE_SPIN_THROUGH) tier = 5;
  if (tier === null) return { ok: true, skip: 'past-band', windowStart, position };

  // The 10-spin bell announces "a Jackpot just hit" — only true when this
  // window was opened by a hit, and only safe once that hit's reveal has run
  // (jackpot_draws doc exists — awardJackpotDraw creates it at reveal).
  if (tier === 10) {
    if (windowStart <= rollingStart) return { ok: true, skip: 'first-window', windowStart };
    const revealed = await db.collection('jackpot_draws')
      .where('draftNo', '==', windowStart - 1).limit(1).get();
    if (revealed.empty) return { ok: true, skip: 'hit-not-revealed', windowStart };
  }

  // Once-per-window-per-tier gate.
  const markerRef = db.collection('jp_window_bells').doc(`${windowStart}-${tier}`);
  try {
    await markerRef.create({ windowStart, tier, position, filled, atIso: new Date().toISOString() });
  } catch {
    return { ok: true, skip: 'already-sent', windowStart, tier };
  }

  // Drafts left in the live band, counting the next draft to fill.
  const bandEnd = windowStart + (tier === 10 ? JP_TEN_SPIN_THROUGH : JP_FIVE_SPIN_THROUGH) - 1;
  const left = bandEnd - filled;
  if (left <= 0) return { ok: true, skip: 'band-exhausted', windowStart, tier };

  const [usersSnap, botsSnap] = await Promise.all([
    db.collection('v2_users').select().get(),
    db.collection('botWallets').select().get(),
  ]);
  const bots = new Set(botsSnap.docs.map((d) => d.id.toLowerCase()));
  const wallets = usersSnap.docs
    .map((d) => d.id.toLowerCase())
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w) && !bots.has(w));

  const bell = tier === 10
    ? {
        title: '🔴 Jackpot Watch: 10 Free Spins',
        message: `If a Jackpot hits in the next ${left} drafts, someone in it wins `
          + `10 Free Spins. Paid drafts only. Part of the Jackpot Hit promo — tap it for more info.`,
      }
    : {
        title: '🔴 Jackpot Watch: 5 Free Spins',
        message: `If a Jackpot hits in the next ${left} drafts, someone in it wins `
          + `5 Free Spins. Paid drafts only. Part of the Jackpot Hit promo — tap it for more info.`,
      };

  const { createNotificationForWallets } = await import('@/lib/queueNotifications');
  await createNotificationForWallets(wallets, {
    type: 'promo',
    ...bell,
    link: '/promos?promo=4',
    dedupeKey: `jp-window-${tier}-${windowStart}`,
    icon: 'spin',
  });

  await markerRef.set({ sentTo: wallets.length }, { merge: true });
  logger.info('jp_window_bells.sent', { windowStart, tier, position, sentTo: wallets.length });
  return { ok: true, sent: tier, windowStart, position, sentTo: wallets.length };
}
