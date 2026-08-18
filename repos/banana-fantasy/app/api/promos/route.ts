import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getPromos } from '@/lib/db';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const userId = getSearchParam(req, 'userId');
    if (!userId) {
      // Return default promo templates for logged-out users (view only, no claims)
      const { getDefaultPromos } = await import('@/lib/api/seed');
      return json(getDefaultPromos(), 200);
    }

    const promos = await getPromos(userId);

    // Stamp live lifetime stats onto the daily-drafts promo for the modal
    // ("paid drafts all-time"). Authoritative Go count (same source as
    // ripeness/King); best-effort — a Go hiccup must never break promos.
    try {
      const daily = promos.find((p) => p.type === 'daily-drafts');
      if (daily && /^0x[0-9a-fA-F]{40}$/.test(userId)) {
        const { fetchOwnerPaidFilledCount } = await import('@/lib/api/owner');
        daily.modalContent.lifetimePaidDrafts = await fetchOwnerPaidFilledCount(userId.toLowerCase());
      }
    } catch { /* stats are decoration — promos still return */ }

    // Banana Draw: everything the card + modal render, stamped at read time.
    // timerEndTime drives the promo card's EXISTING bare countdown — no custom
    // "next draw" label, same treatment as Match Your Pick (Boris 2026-07-26).
    try {
      const bd = promos.find((p) => p.type === 'banana-draw');
      if (bd && /^0x[0-9a-fA-F]{40}$/.test(userId)) {
        const { getUserCycleState, getCycleLeaderboard, getUserLedger, getRecentWinners, getBananaDrawSeatCount, getPendingDrafts, getLastDrawEntrantNames }
          = await import('@/lib/bananaDraw');
        const me = userId.toLowerCase();
        const [state, board, ledger, winners, seats, pending, lastDrawEntrants] = await Promise.all([
          getUserCycleState(me),
          getCycleLeaderboard(),
          getUserLedger(me, 50),
          getRecentWinners(5),
          getBananaDrawSeatCount(),
          getPendingDrafts(me),
          getLastDrawEntrantNames(),
        ]);

        // The countdown is the cycle close — the existing formatter renders it.
        bd.timerEndTime = new Date(state.cycle.closesAt).toISOString();

        const e = state.entry;
        bd.modalContent.bananaDraw = {
          cycleId: state.cycle.cycleId,
          closesAt: state.cycle.closesAt,
          bananas: e?.bananas ?? 0,
          free: e?.free ?? 0,
          paid: e?.paid ?? 0,
          referral: e?.referral ?? 0,
          freeDrafts: e?.freeDrafts ?? 0,
          paidDrafts: e?.paidDrafts ?? 0,
          referrals: e?.referrals ?? 0,
          pending, // entered but not yet filled — Bananas land at FILL
          sharePct: state.sharePct,
          totalBananas: state.totalBananas,
          entrantCount: state.entrantCount,
          // Names resolved SERVER-side from the stored username/bananaNumber —
          // never derived from the wallet hash, which invents handles.
          leaderboard: board.rows.map((r) => ({
            name: r.name,
            bananas: r.bananas,
            sharePct: r.sharePct,
            isYou: r.userId === me,
          })),
          // Cast of the replayed draw — yesterday's entrants, not today's board.
          lastDrawEntrants,
          seatsClaimed: seats.claimed,
          seatsTotal: seats.total,
          recentWinners: winners,
          allTime: ledger.map((l) => ({
            cycleId: l.cycleId, source: l.source, bananas: l.bananas, at: l.at,
          })),
        };
      }
    } catch { /* live stats are decoration — promos still return */ }

    // Around The Banana: live race state for the card's slot grid + seats-left
    // counter, stamped at read time (persisted per-user fields + the one
    // global winners doc). Decoration — a failure never breaks the list.
    try {
      const atb = promos.find((p) => p.type === 'around-the-banana');
      if (atb) {
        // Seeded per-user docs carry the launch-day description, which the
        // 2-line card clamp truncated ("...and win a…") — keep every user's
        // card on the current copy (Boris 2026-08-17). Same string on the
        // carousel, sidebar and /promos card.
        atb.description = 'First 10 people to hit all 10 slots win a Jackpot seat.\nEvery draft counts, paid or free.';
        const { getAtbSeatCount } = await import('@/lib/aroundTheBanana');
        const seats = await getAtbSeatCount();
        const mc = atb.modalContent as unknown as Record<string, unknown>;
        atb.modalContent.aroundTheBanana = {
          slotsHit: (mc.atbSlotsHit as number[] | undefined) ?? [],
          seatsClaimed: seats.claimed,
          seatsTotal: seats.total,
          completed: !!mc.atbCompletedAt,
          won: !!mc.atbWonAt,
          seatNumber: mc.atbSeatNumber as number | undefined,
        };
      }
    } catch { /* live stats are decoration — promos still return */ }

    // THE DROP: rebuild the modal's prize copy from tonight's ACTUAL pool.
    // Per-user promo docs are seeded snapshots, so a one-night pool boost
    // (NIGHT_PRIZE_OVERRIDES) would otherwise show yesterday's list.
    try {
      const drop = promos.find((p) => p.type === 'drop');
      if (drop) {
        const { dropExplanationFor, revealNightIdFor, nightlyPrizesFor, spinsForNight } = await import('@/lib/dropRates');
        const nightId = revealNightIdFor(Date.now());
        drop.modalContent.explanation = dropExplanationFor(nightId);
        // Seeded per-user docs carry the old CTA + 8PM description — keep both
        // live-synced with the current schedule/wording (9PM, 2026-08-05).
        drop.ctaText = 'Open your packs';
        // Card line names tonight's prizes (Boris 2026-08-18) — seats from the
        // live prize table (so a one-night override shows), spins summed.
        const rows = nightlyPrizesFor(nightId);
        const seatWords = rows
          .filter((r) => r.kind === 'jackhof' || r.kind === 'hof' || r.kind === 'jackpot')
          .map((r) => `${r.count} ${r.kind === 'jackhof' ? 'JackHOF' : r.kind === 'hof' ? 'HOF' : 'Jackpot'} seat${r.count === 1 ? '' : 's'}`);
        const spins = spinsForNight(nightId);
        const prizeLine = [...seatWords, spins > 0 ? `${spins} Free Spins` : null].filter(Boolean).join(' · ');
        drop.description = `Fill drafts, earn packs. Open them at 9 PM.\nTonight: ${prizeLine}.`;
        drop.isNew = false; // NEW ribbon retired 2026-08-05 — promo is established now
      }
    } catch { /* copy refresh is decoration — promos still return */ }

    // Jackpot promo: live cycle position + latest draw. Position comes from
    // getJackpotCycleState → computeJpCycle, the SAME math awardJackpotDraw
    // credits with. It used to do its own `(filled - 1) % 100`, which ignored
    // the rolling-lane reset — so after a jackpot hit the card announced
    // "bonus windows closed" while the lane had actually restarted and the
    // next hit really was worth 10 spins (Boris 2026-07-25).
    try {
      const jp = promos.find((p) => p.type === 'jackpot');
      if (jp) {
        const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
        const { getJackpotCycleState } = await import('@/lib/db-firestore');
        const db = getAdminFirestore();
        const cycle = await getJackpotCycleState();
        jp.modalContent.cycle = {
          filledCount: cycle.filled,
          position: cycle.position,
          windowLength: cycle.windowLength,
          reward: cycle.reward,
          tenLeft: cycle.tenLeft,
          fiveLeft: cycle.fiveLeft,
        };
        const last = await db.collection('jackpot_draws')
          .where('pending', '==', false).orderBy('atIso', 'desc').limit(1).get()
          .catch(() => null);
        const d = last && !last.empty ? last.docs[0].data() : null;
        if (d?.winnerName) {
          jp.modalContent.latestDraw = {
            draftName: String(d.displayName ?? d.draftId ?? ''),
            winnerName: String(d.winnerName),
            reward: Number(d.reward ?? 0),
            atIso: String(d.atIso ?? ''),
          };
        }
      }
    } catch { /* live stats are decoration */ }

    // One-time backfill: users who bought passes BEFORE per-purchase history
    // existed (2026-06-10) get their Buy-10 Purchase History reconstructed
    // from the real completed purchase records, then persisted so this never
    // runs again for them.
    try {
      const mint = promos.find((p) => p.type === 'mint');
      if (mint && (mint.modalContent.totalMinted ?? 0) > 0 && !(mint.modalContent.mintHistory?.length)) {
        const { getPurchaseHistory } = await import('@/lib/db');
        const completed = (await getPurchaseHistory(userId))
          .filter((x) => x.status === 'completed' && x.quantity > 0)
          .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
          .slice(0, 50);
        if (completed.length > 0) {
          mint.modalContent.mintHistory = completed.map((x) => ({
            date: x.createdAt.slice(0, 10),
            quantity: x.quantity,
            status: 'claimed' as const,
          }));
          const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
          await getAdminFirestore()
            .collection('v2_users').doc(userId)
            .collection('promos').doc(mint.id)
            .set({ modalContent: { mintHistory: mint.modalContent.mintHistory } }, { merge: true });
        }
      }
    } catch { /* backfill is best-effort */ }

    // Backstop: new accounts seeded before the welcome noti existed (or whose
    // seed-time write was lost) get it here — dedupe-keyed, so for everyone
    // else this is a guaranteed no-op. Some user docs are created by stub
    // writes that bypass the full seed and carry NO createdAt (caught live on
    // 0x9a74…e17b) — stamp those now, and treat zero-activity unstamped docs
    // as new. Accounts with any passes/spins/balance can never qualify.
    try {
      const { getAdminFirestore } = await import('@/lib/firebaseAdmin');
      const userRef = getAdminFirestore().collection('v2_users').doc(userId);
      const userSnap = await userRef.get();
      const u = (userSnap.data() ?? {}) as { createdAt?: string; createdAtEstimated?: boolean; isReturningPlayer?: boolean; draftPasses?: number; freeDrafts?: number; wheelSpins?: number; usdcBalance?: number };
      if (userSnap.exists && !u.createdAt) {
        // Backfill stamp is marked ESTIMATED — a legacy account stamped
        // "today" must never read as a 7-day-new account on its next visit
        // (that loophole gave Boris's admin wallet a welcome noti).
        await userRef.set({ createdAt: new Date().toISOString(), createdAtEstimated: true }, { merge: true }).catch(() => {});
      }
      const zeroActivity = !(u.draftPasses ?? 0) && !(u.freeDrafts ?? 0) && !(u.wheelSpins ?? 0) && !(u.usdcBalance ?? 0);
      // New = real (non-estimated) createdAt within 7 days. Accounts with
      // only an estimated stamp (or none) must ALSO be zero-activity.
      const isNew = u.createdAt && !u.createdAtEstimated
        ? Date.now() - new Date(u.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
        : userSnap.exists && zeroActivity;
      // Played a previous season (BBB1-3)? Not a "new user" — no welcome
      // noti, whatever the account age (Boris's definition 2026-06-10).
      const { isReturningWalletSync } = await import('@/lib/returningUsers');
      if (isNew && !u.isReturningPlayer && !isReturningWalletSync(userId)) {
        // Lifetime-activity guard: the zeroActivity check above only looks at
        // CURRENT balances, so an active player who's spent all their spins/
        // drafts reads as "new" and gets a welcome noti (hit by Richard's
        // 32-spin account, 2026-06-16). A user who has EVER spun the wheel or
        // drafted is not new — check the history before firing. Only runs when
        // a welcome would otherwise fire, so it's not a hot-path cost.
        const [spun, drafted] = await Promise.all([
          userRef.collection('wheelSpins').limit(1).get(),
          userRef.collection('draftHistory').limit(1).get(),
        ]);
        if (spun.empty && drafted.empty) {
          const { createNotification } = await import('@/lib/queueNotifications');
          await createNotification(userId, {
            type: 'welcome',
            title: 'Welcome! Free Spin Waiting',
            message: 'Verify your X account to earn a Free Banana Spin — win up to 20 free drafts, at least 1 guaranteed. Tap to claim.',
            link: '/promos?promo=6',
            dedupeKey: 'welcome-new-user',
            icon: 'party',
          });
        }
      }
    } catch { /* best-effort */ }

    return json(promos, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
