import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { API_CONFIG } from '@/lib/api/config';
import { logger } from '@/lib/logger';

/**
 * Kickoff (buy-bonus) retirement sweep (Boris 2026-08-09): the window closes
 * itself at endsAtMs (midnight PT) — purchases stop counting and the card
 * hides. This sweep runs ONCE right after that and auto-credits anyone still
 * holding an earned-but-unclaimed milestone spin, so nothing is stranded
 * behind a card nobody can see anymore.
 *
 * Candidates come from the purchase feed (only buyers could have progressed
 * the promo), so we never scan the whole user base. Once-ever via a
 * promo_sweeps marker; per-user the credit is transactional against the
 * promo doc's own claimCount, so a user claiming at 11:59:59 can't be
 * double-paid.
 */
export async function runBuyBonusRetirementSweep(): Promise<Record<string, unknown>> {
  const endsAtMs = API_CONFIG.promos.buyBonus.endsAtMs;
  if (Date.now() < endsAtMs) return { ok: true, skip: 'window-still-open' };

  const db = getAdminFirestore();
  const markerRef = db.collection('promo_sweeps').doc(`buy-bonus-${endsAtMs}`);
  try {
    await markerRef.create({ startedAtIso: new Date().toISOString() });
  } catch {
    return { ok: true, skip: 'already-swept' };
  }

  // Buyers during the promo window (wide margin) — the only possible holders.
  const since = new Date(endsAtMs - 7 * 24 * 3600_000);
  const evs = await db.collection('v2_activity_events')
    .where('createdAt', '>=', since).get();
  const wallets = new Set<string>();
  evs.forEach((d) => {
    const e = d.data() as { type?: string; wallet?: string; userId?: string };
    if (e.type !== 'pass_purchased') return;
    const w = (e.wallet || e.userId || '').toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(w)) wallets.add(w);
  });

  let credited = 0;
  let totalSpins = 0;
  for (const w of wallets) {
    const promoSnap = await db.collection('v2_users').doc(w)
      .collection('promos').where('type', '==', 'buy-bonus').limit(1).get();
    if (promoSnap.empty) continue;
    const promoRef = promoSnap.docs[0].ref;
    const userRef = db.collection('v2_users').doc(w);
    const spins = await db.runTransaction(async (tx) => {
      const p = (await tx.get(promoRef)).data() as { claimable?: boolean; claimCount?: number } | undefined;
      if (!p) return 0;
      const n = p.claimCount || (p.claimable ? 1 : 0);
      if (n <= 0) return 0;
      const u = (await tx.get(userRef)).data() as { wheelSpins?: number } | undefined;
      tx.update(userRef, { wheelSpins: (u?.wheelSpins || 0) + n });
      tx.update(promoRef, { claimable: false, claimCount: 0 });
      return n;
    }).catch((err) => {
      logger.error('buybonus_sweep.user_failed', { wallet: w, err: (err as Error).message });
      return 0;
    });
    if (spins > 0) {
      credited++;
      totalSpins += spins;
      const { createNotification } = await import('@/lib/queueNotifications');
      await createNotification(w, {
        type: 'promo',
        title: 'Kickoff spins added 🍌',
        message: `The Kickoff promo has ended — your ${spins} earned Promo Spin${spins === 1 ? '' : 's'} `
          + `${spins === 1 ? 'was' : 'were'} added to your wheel automatically. Go spin!`,
        link: '/banana-wheel',
        dedupeKey: `kickoff-retire-${endsAtMs}`,
        icon: 'spin',
      }).catch(() => {});
    }
  }

  await markerRef.set({ finishedAtIso: new Date().toISOString(), buyers: wallets.size, credited, totalSpins }, { merge: true });
  logger.info('buybonus_sweep.done', { buyers: wallets.size, credited, totalSpins });
  return { ok: true, buyers: wallets.size, credited, totalSpins };
}
