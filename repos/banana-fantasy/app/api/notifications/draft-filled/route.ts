import { NextRequest, NextResponse } from 'next/server';
import { deliverToRecipient } from '@/lib/notifications/deliver';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { computeAndStoreRipeness, recordDraftCompletion, recordPick10, resolveDraftPassType, unlockBadge } from '@/lib/db';
import { fetchOwnerPaidFilledCount } from '@/lib/api/owner';
import { logActivityEvent } from '@/lib/activityEvents';
import { getDraftInfo } from '@/lib/draftApi';
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
    const [jp, hof] = await Promise.all([
      db.collection('v2_queues').doc('jackpot').get(),
      db.collection('v2_queues').doc('hof').get(),
    ]);
    const has = (snap: FirebaseFirestore.DocumentSnapshot) => {
      const rounds = (snap.exists ? snap.data()?.rounds : null) as Array<{ draftId?: string }> | null;
      return Array.isArray(rounds) && rounds.some((r) => r?.draftId === draftId);
    };
    if (has(jp)) return 'Jackpot Draft';
    if (has(hof)) return 'HOF Draft';
    return null;
  } catch {
    return null;
  }
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
        const badgeId = queueLabel === 'Jackpot Draft' ? 'jackpot-club' : 'hof-club';
        await Promise.allSettled(wallets.map((w) =>
          unlockBadge(w.toLowerCase(), badgeId, { source: 'queue-draft-filled', draftId }),
        ));
      }

      // Pick 10: slot 10 = draft-order index 9 (bots included in the order).
      try {
        const info = await getDraftInfo(draftId);
        const slot10 = info?.draftOrder?.[9]?.ownerId?.toLowerCase();
        if (slot10 && !slot10.startsWith('bot-')) {
          await recordPick10(slot10, draftId, draftName ?? draftId);
        }
      } catch (err) {
        logger.warn('notifications.draft_filled.pick10_credit_failed', {
          draftId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })());
    const event = { type: 'draft.filled' as const, draftId, draftName: queueLabel ?? draftName };

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
