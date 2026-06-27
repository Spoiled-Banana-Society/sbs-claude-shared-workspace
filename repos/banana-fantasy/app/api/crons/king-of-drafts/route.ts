export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { unlockBadge, revokeBadge } from '@/lib/db';
import { ACTIVITY_EVENTS_COLLECTION } from '@/lib/activityEvents';
import { lastClosedKingWeek, tallyKingDrafts, compareKing } from '@/lib/kingWeek';
import { logger } from '@/lib/logger';

// Singleton doc tracking who currently holds the transient King badge.
const KING_STATE_DOC = 'badgeState/king-of-drafts';

function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

/**
 * GET /api/crons/king-of-drafts  (Vercel weekly cron + manual admin trigger)
 *
 * Crowns the wallet whose PAID drafts FILLED the most in the Mon–Sun week
 * closing Sunday 11pm PT (cron: Monday 06:00 UTC = Sun 11pm PDT). Counting
 * basis is `draft_filled` activity events written by the fill webhook — NOT
 * entries: an entered-then-left draft refunds the pass and must not count
 * (Boris 2026-06-10; also closes the join/leave farming hole). Free passes
 * never count. The badge is transient — revoked from the previous holder and
 * unlocked on the new one (which fires their bell + toast). If the same
 * wallet wins again, it's a no-op beyond refreshing the count.
 *
 * The live in-week standings use the SAME counting in
 * /api/badges/king-leaderboard, so what users watch all week is exactly what
 * gets crowned.
 *
 * Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}`. Manual runs
 * must send the same header.
 */
export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);

  try {
    const db = getAdminFirestore();
    // The week that just closed: Mon 5am PT → Sun 11pm PT (lib/kingWeek.ts) —
    // the SAME window the live leaderboard shows, so what users watched all
    // week is exactly what gets crowned.
    const week = lastClosedKingWeek(Date.now());
    const sinceIso = week.startIso;

    // Single-field range query (auto-indexed) — filter type + paid in memory
    // so we don't depend on a composite index.
    const snap = await db
      .collection(ACTIVITY_EVENTS_COLLECTION)
      .where('createdAtIso', '>=', sinceIso)
      .get();

    // Tally + rank using the SHARED helper (lib/kingWeek) so the crown matches
    // the live leaderboard exactly. Winner = most paid drafts; ties go to
    // whoever reached that count FIRST (earliest last-counting-draft).
    const ranked = [...tallyKingDrafts(snap.docs, week.endIso).entries()].sort(compareKing);
    const winner: string | null = ranked.length ? ranked[0][0] : null;
    const best = ranked.length ? ranked[0][1].count : 0;

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
