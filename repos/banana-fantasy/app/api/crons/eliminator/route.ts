export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { json, jsonError } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { runDueBurns, runDueReveal } from '@/lib/eliminatorRun';
import { ADMIN_PREVIEW_PROMO_TYPES } from '@/lib/promoFilter';
import { eliminatorRetired } from '@/lib/promoWindow';

/**
 * GET /api/crons/eliminator — the hourly burn, BACKSTOP path.
 *
 * The board triggers each burn itself the moment its countdown hits zero
 * (/api/promos/eliminator/tick), which is what makes it land on the dot. This
 * cron exists for the case nobody has the page open: it runs every minute and
 * catches any burn the clients missed, plus any the site slept through.
 *
 * All the real work — executing the burn, the pushes, the JackHOF seat, the
 * runner-up spins — lives in runDueBurns so the two paths cannot drift.
 *
 * ⚠️ GREEN-LIGHT SWITCH: while 'eliminator' sits in ADMIN_PREVIEW_PROMO_TYPES
 * the burn holds completely — no burns, no pushes, no prizes.
 */
function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  if (ADMIN_PREVIEW_PROMO_TYPES.includes('eliminator')) {
    return json({ ok: true, held: 'admin-preview', burns: 0 });
  }
  const now = Date.now();
  // RETIRED (2026-08-01): no further burns. The REVEAL still runs below — if the
  // final five were locked but the seat hadn't been drawn yet when this shipped,
  // retiring the promo must not be what strands their payout.
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
    logger.error('eliminator.cron_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
