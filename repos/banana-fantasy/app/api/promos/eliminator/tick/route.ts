export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { runDueBurns, runDueReveal } from '@/lib/eliminatorRun';
import { ADMIN_PREVIEW_PROMO_TYPES } from '@/lib/promoFilter';
import { eliminatorRetired } from '@/lib/promoWindow';

/**
 * POST /api/promos/eliminator/tick — let the board fire the burn on the dot.
 *
 * Vercel cron granularity is one minute, so a burn scheduled for 8:00 executed
 * anywhere in 8:00:00-8:00:59 (measured 58.6s and 46.4s on the first two).
 * The countdown hit zero and the board just sat there. Now every open board
 * calls this the instant its own clock expires, so the burn fires within a
 * second of the hour and the animation plays immediately. The cron stays as the
 * backstop for when nobody has the page open.
 *
 * ⚠️ Deliberately UNAUTHENTICATED, and safe because it cannot make anything
 * happen early or differently:
 *   • runDueBurns only executes burns whose scheduled instant has already
 *     PASSED — calling this at 7:59 does nothing at all;
 *   • executeBurn claims each burn index inside a transaction, so a thousand
 *     simultaneous callers produce exactly one burn and the rest no-op;
 *   • the outcome derives from the sealed VRF seed committed before the day
 *     opened, so no caller can influence who survives.
 * The worst a bad actor achieves is running the burn we were about to run.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  if (ADMIN_PREVIEW_PROMO_TYPES.includes('eliminator')) {
    return json({ ok: true, held: 'admin-preview', burns: 0 });
  }
  const now = Date.now();
  // RETIRED (2026-08-01) — same shape as the cron: burns stop, a pending reveal
  // is still allowed to land.
  if (eliminatorRetired(now)) {
    const reveal = await runDueReveal(now).catch(() => ({ revealed: false }));
    return json({ ok: true, held: 'retired', burns: 0, reveal });
  }
  try {
    const burns = await runDueBurns(now);
    // Beat two rides the same tick — no separate schedule to drift.
    const reveal = await runDueReveal(now).catch(() => ({ revealed: false }));
    return json({ ...burns, reveal });
  } catch (err) {
    logger.error('eliminator.tick_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
