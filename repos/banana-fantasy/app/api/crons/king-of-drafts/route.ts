export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { unlockBadge, revokeBadge } from '@/lib/db';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { logger } from '@/lib/logger';

// Singleton doc tracking who currently holds the transient King badge.
const KING_STATE_DOC = 'badgeState/king-of-drafts';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

/**
 * GET /api/crons/king-of-drafts  (Vercel weekly cron + manual admin trigger)
 *
 * Crowns the wallet that entered the most PAID drafts in the trailing 7 days
 * (free drafts don't count). The badge is transient — it's revoked from the
 * previous holder and unlocked on the new one (which fires their bell + toast).
 * If the same wallet wins again, it's a no-op beyond refreshing the count.
 *
 * Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}`. Manual runs
 * must send the same header.
 */
export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);

  try {
    const db = getAdminFirestore();
    const sinceIso = new Date(Date.now() - WEEK_MS).toISOString();

    // Single-field range query (auto-indexed) — filter type + paid in memory
    // so we don't depend on a composite index.
    const snap = await db
      .collection(ACTIVITY_EVENTS_COLLECTION)
      .where('createdAtIso', '>=', sinceIso)
      .get();

    const counts = new Map<string, number>();
    for (const doc of snap.docs) {
      const e = doc.data() as {
        type?: string;
        userId?: string;
        metadata?: { passType?: string };
      };
      if (e.type !== 'draft_entered') continue;
      if (e.metadata?.passType !== 'paid') continue; // free drafts don't count
      const wallet = (e.userId || '').toLowerCase();
      if (!wallet || wallet.startsWith('bot-')) continue;
      counts.set(wallet, (counts.get(wallet) ?? 0) + 1);
    }

    // Winner = most paid drafts; ties broken deterministically (lowest wallet)
    // so re-runs are stable.
    let winner: string | null = null;
    let best = 0;
    for (const [wallet, n] of counts) {
      if (n > best || (n === best && winner !== null && wallet < winner)) {
        best = n;
        winner = wallet;
      }
    }

    const stateRef = db.doc(KING_STATE_DOC);
    const prevSnap = await stateRef.get();
    const prevHolder = prevSnap.exists ? ((prevSnap.data()?.wallet as string) || null) : null;

    if (!winner) {
      logger.info('cron.king-of-drafts.no-entries', { sinceIso });
      return json({ ok: true, winner: null, reason: 'no paid drafts this week', prevHolder }, 200);
    }

    let changed = false;
    if (prevHolder && prevHolder !== winner) {
      await revokeBadge(prevHolder, 'king-of-drafts');
      changed = true;
    }
    // Idempotent: only fires the bell/toast on the first unlock for this wallet.
    const newlyUnlocked = await unlockBadge(winner, 'king-of-drafts', {
      source: 'weekly-cron',
      paidDrafts: best,
      weekStart: sinceIso,
    });

    await stateRef.set(
      { wallet: winner, paidDrafts: best, weekStart: sinceIso, updatedAt: new Date().toISOString() },
      { merge: true },
    );

    logger.info('cron.king-of-drafts.crowned', { winner, paidDrafts: best, prevHolder, newlyUnlocked });
    return json({ ok: true, winner, paidDrafts: best, prevHolder, changed, newlyUnlocked }, 200);
  } catch (err) {
    logger.error('cron.king-of-drafts.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
