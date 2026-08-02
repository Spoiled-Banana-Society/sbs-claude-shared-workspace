import { NextRequest, NextResponse } from 'next/server';
import { deliverToRecipient } from '@/lib/notifications/deliver';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { computeAndStoreRipeness, recordDraftCompletion, resolveDraftPassType, unlockBadge } from '@/lib/db';
import { fetchOwnerPaidFilledCount } from '@/lib/api/owner';
import { logActivityEvent } from '@/lib/activityEvents';
import { creditBananas, creditReferralBananas } from '@/lib/bananaDraw';
import { creditDraft as creditEliminatorDraft } from '@/lib/eliminator';
import { awardPacksForFill } from '@/lib/drop';
import { runInBackground } from '@/lib/serverBackground';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

/**
 * Queue drafts (Jackpot/HOF) are known-type by construction — their round
 * stores the created draftId. Resolve so the alert can say "Jackpot Draft
 * filled" instead of the generic draft name. Best-effort: any failure falls
 * back to the generic copy.
 */
async function queueDraftLabel(draftId: string): Promise<string | null> {
  if (!isFirestoreConfigured()) return null;
  try {
    const db = getAdminFirestore();
    // jackhof MUST be checked — it was missing until 2026-07-26, so a filled
    // JackHOF queue draft returned null: no club badge for anyone in it, and
    // generic "draft filled" copy. Silently affected organic 0.1% wheel
    // winners too, not just Banana Draw seats. Checked FIRST so a draft that
    // somehow appears in more than one queue resolves to the rarest type.
    const [jackhof, jp, hof] = await Promise.all([
      db.collection('v2_queues').doc('jackhof').get(),
      db.collection('v2_queues').doc('jackpot').get(),
      db.collection('v2_queues').doc('hof').get(),
    ]);
    const has = (snap: FirebaseFirestore.DocumentSnapshot) => {
      const rounds = (snap.exists ? snap.data()?.rounds : null) as Array<{ draftId?: string }> | null;
      return Array.isArray(rounds) && rounds.some((r) => r?.draftId === draftId);
    };
    if (has(jackhof)) return 'JackHOF Draft';
    if (has(jp)) return 'Jackpot Draft';
    if (has(hof)) return 'HOF Draft';
    return null;
  } catch {
    return null;
  }
}

/**
 * Re-read the draft's authoritative DisplayName ("BBB #<cumulative>") fresh.
 * The Go fill writes numPlayers=10 to RTDB (which fires onDraftFilled) BEFORE
 * it sets the DisplayName (leagues.go), so the name the Cloud Function passes
 * can be empty at the fill instant — which made the alert fall back to the
 * per-speed SLOT number ("#3" instead of the real "#36"). A short retry lets
 * the cumulative number land before we render. Best-effort: returns undefined
 * if it never appears (copy then stays generic, never a wrong number).
 */
async function resolveDisplayName(draftId: string): Promise<string | undefined> {
  if (!isFirestoreConfigured()) return undefined;
  const db = getAdminFirestore();
  for (let i = 0; i < 3; i++) {
    try {
      const snap = await db.doc(`drafts/${draftId}`).get();
      const dn = snap.exists ? (snap.data()?.DisplayName as string | undefined) : undefined;
      if (dn && /\d/.test(dn)) return dn;
    } catch {
      /* transient — retry */
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 700));
  }
  return undefined;
}

const INTERNAL_SECRET = process.env.NOTIFICATIONS_INTERNAL_SECRET;

/**
 * POST /api/notifications/draft-filled  —  EVENT A: "your draft filled".
 *
 * SERVER-TO-SERVER ONLY. Called by the `onDraftFilled` Cloud Function when
 * a draft reaches 10 players. Fans an alert to every league member across
 * each channel they've connected. Atomic dedup on `{wallet}__{draftId}__filled`
 * makes duplicate trigger fires safe.
 *
 * Body: { draftId, draftName?, wallets: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    if (!INTERNAL_SECRET) {
      // Misconfiguration — the route can't authenticate any caller, so
      // every "draft filled" alert silently dies. Make it loud in the Logs.
      logger.error(LOG_SOURCES.notifications.SECRET_MISSING, {
        err: 'NOTIFICATIONS_INTERNAL_SECRET is unset or blank on the Vercel deploy',
        route: 'notifications/draft-filled',
      });
      return NextResponse.json(
        { error: 'NOTIFICATIONS_INTERNAL_SECRET not configured' },
        { status: 503 },
      );
    }
    if (req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    const draftName = typeof body.draftName === 'string' ? body.draftName : undefined;
    const wallets: string[] = Array.isArray(body.wallets)
      ? body.wallets.filter((w: unknown): w is string => typeof w === 'string' && w.length > 0)
      : [];

    if (!draftId) {
      return NextResponse.json({ error: 'draftId required' }, { status: 400 });
    }
    if (wallets.length === 0) {
      return NextResponse.json({ ok: true, reports: [] });
    }

    // Jackpot/HOF queue drafts get type-named copy ("Jackpot Draft filled")
    // and fill-time club badges below.
    const queueLabel = await queueDraftLabel(draftId);

    // SERVER-SIDE promo crediting at the fill moment. This webhook is the
    // only RELIABLE fill observer — the client paths (drafting page /
    // draft-room) only fire if that wallet's browser happens to be open when
    // the draft fills, which silently missed credits (Boris's "timer never
    // started" bug). Everything here is idempotent per draftId, so the client
    // firing too is harmless. promoCreditAllowed/resolveDraftPassType enforce
    // PAID-only off the authoritative token stamp.
    runInBackground('promo.fill-credit', (async () => {
      // 4 Drafts Daily: +1 (and the 24h timer on the first) for every human.
      await Promise.allSettled(wallets.map((w) => recordDraftCompletion(w.toLowerCase(), draftId)));

      // BANANA DRAW: every filled draft is Bananas toward the next JackHOF
      // seat — free 1, paid 2. Deliberately credited for FREE drafts too: the
      // promo exists to make people burn the free stack they're hoarding, so
      // it does NOT go through promoCreditAllowed (which is paid-only). The
      // pass type still comes from resolveDraftPassType — the authoritative
      // token stamp — so the free/paid split itself can't be spoofed.
      // Idempotent per (cycle, wallet, draftId), so the backstop re-firing is
      // harmless. Runs for EVERY wallet, before the paid-only block below.
      await Promise.allSettled(wallets.map(async (w) => {
        const wallet = w.toLowerCase();
        const passType = await resolveDraftPassType(wallet, draftId).catch(() => null);
        await creditBananas({
          userId: wallet,
          source: passType === 'paid' ? 'draft-paid' : 'draft-free',
          refId: draftId,
          meta: { via: 'fill_webhook' },
        }).catch((err) => logger.warn('banana.fill_credit_failed', { draftId, wallet, err: String(err) }));

        // ...and pay whoever invited them — once ever per friend, and ONLY if
        // that friend signed up after the promo launched. This used to fire on
        // any fill by anyone ever referred, which back-paid the whole historic
        // referral book on launch day. See creditReferralBananas.
        await creditReferralBananas({ friendUserId: wallet, kind: 'draft' })
          .catch((err) => logger.warn('banana.referral_fill_credit_failed', { draftId, wallet, err: String(err) }));

        // THE ELIMINATOR: credited at FILL, not at entry.
        //
        // ⚠️ This used to fire from /api/owner/use-pass the moment a seat was
        // taken. Leaving a filling lobby REFUNDS the pass (see
        // /api/owner/refund-pass), so entry-crediting meant: enter → earn →
        // leave → get the pass back → enter again → earn again, without limit
        // and for free. On launch day 16 users left 41 drafts and kept the
        // Bananas from every one of them (Richard caught it 2026-07-31).
        //
        // Crediting here means the draft has actually filled and started, so
        // the Bananas represent real play that can't be unwound. Same
        // authoritative pass type and the same per-(day, wallet, draft)
        // idempotency, so the backstop re-firing is harmless.
        await creditEliminatorDraft({
          userId: wallet,
          draftId,
          passType: passType === 'paid' ? 'paid' : 'free',
        }).catch((err) => logger.warn('eliminator.fill_credit_failed', { draftId, wallet, err: String(err) }));

        // THE DROP: a filled draft earns sealed packs for tonight's 8pm drop.
        // Paid 2, free 1. Awarded HERE and nowhere else — entering must never
        // award, because leaving a filling lobby refunds the pass and that
        // makes enter/earn/leave/repeat free and unbounded.
        //
        // Runs even while the promo is gated to admin preview: packs accrue
        // quietly so the first live night opens full instead of empty. The
        // cron holds the lock and the prizes, so nothing can be won until the
        // promo is released.
        await awardPacksForFill({
          userId: wallet,
          draftId,
          passType: passType === 'paid' ? 'paid' : 'free',
          notify: true,
        }).catch((err) => logger.warn('drop.fill_award_failed', { draftId, wallet, err: String(err) }));
      }));

      // Per-wallet PAID-fill effects: the King-of-Drafts scoring record (King
      // counts FILLED paid drafts — entries can be left/refunded and farmed)
      // and the ripeness tiers (Unripe at 1 paid filled, etc.) unlock at the
      // fill moment, not lazily on the next profile open.
      await Promise.allSettled(wallets.map(async (w) => {
        const wallet = w.toLowerCase();
        const passType = await resolveDraftPassType(wallet, draftId).catch(() => null);
        if (passType !== 'paid') return;
        await logActivityEvent({
          type: 'draft_filled',
          userId: wallet,
          walletAddress: wallet,
          metadata: { draftId, passType: 'paid', source: 'fill_webhook' },
        }).catch((err) => logger.warn('notifications.draft_filled.activity_log_failed', { draftId, wallet, err: String(err) }));
        await computeAndStoreRipeness(wallet, await fetchOwnerPaidFilledCount(wallet))
          .catch((err) => logger.warn('notifications.draft_filled.ripeness_failed', { draftId, wallet, err: String(err) }));
      }));

      // Wheel-won Jackpot/HOF queue drafts: the club badge unlocks when THIS
      // draft fills (Boris 2026-06-10 — not at the wheel-spin moment). The
      // type was never secret for queue drafts, so no reveal-timing concern.
      if (queueLabel) {
        const badgeId = queueLabel === 'JackHOF Draft' ? 'jackhof-club'
          : queueLabel === 'Jackpot Draft' ? 'jackpot-club'
          : 'hof-club';
        await Promise.allSettled(wallets.map((w) =>
          unlockBadge(w.toLowerCase(), badgeId, { source: 'queue-draft-filled', draftId }),
        ));
      }

      // NOTE: Pick 10 is NOT credited here — at the fill instant the draft
      // ORDER doesn't exist yet (slots are randomized after fill), so
      // getDraftInfo has no slot-10 to read (caught live on draft 1382,
      // 2026-06-10). Pick 10 credits at the reveal moment (reveal-complete
      // route — any watcher triggers it, order exists by then) with the
      // guaranteed backstop at close (refresh-draft route).
    })());
    // Prefer the queue label (Jackpot/HOF), then the fresh authoritative
    // DisplayName ("BBB #<cumulative>"), then whatever the Cloud Function
    // passed. This is what makes the alert show the real cumulative league
    // number instead of the per-speed slot number.
    const freshName = await resolveDisplayName(draftId);
    const event = { type: 'draft.filled' as const, draftId, draftName: queueLabel ?? freshName ?? draftName };

    // One bad recipient (e.g. a dedup-store hiccup) must not sink the batch.
    const reports = await Promise.all(
      wallets.map((w) =>
        deliverToRecipient(w, event).catch((err) => ({
          walletAddress: w.toLowerCase(),
          outcome: 'failed' as const,
          error: err instanceof Error ? err.message : String(err),
        })),
      ),
    );

    logger.debug(`[draft-filled] draft=${draftId} recipients=${wallets.length}`);
    return NextResponse.json({ ok: true, reports });
  } catch (err) {
    console.error('[draft-filled] Error:', err);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
  }
}
