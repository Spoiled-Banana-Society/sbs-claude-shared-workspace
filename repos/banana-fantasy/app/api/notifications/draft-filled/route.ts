import { NextRequest, NextResponse } from 'next/server';
import { deliverToRecipient } from '@/lib/notifications/deliver';
import { getAdminFirestore, isFirestoreConfigured } from '@/lib/firebaseAdmin';
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

    // Jackpot/HOF queue drafts get type-named copy ("Jackpot Draft filled").
    const queueLabel = await queueDraftLabel(draftId);
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
