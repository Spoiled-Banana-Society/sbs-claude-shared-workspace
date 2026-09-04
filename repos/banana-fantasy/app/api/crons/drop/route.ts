export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { json, jsonError } from '@/lib/api/routeUtils';
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { runDropSchedule } from '@/lib/dropRun';
import { runJpWindowBells } from '@/lib/jpWindowBells';
import { runBuyBonusRetirementSweep } from '@/lib/buyBonusSweep';
import { runLaneRolloverGuard } from '@/lib/laneRolloverGuard';
import { ADMIN_PREVIEW_PROMO_TYPES } from '@/lib/promoFilter';

/**
 * GET /api/crons/drop — locks the night at 8pm, sweeps at midnight.
 *
 * ⚠️ GREEN-LIGHT SWITCH: while 'drop' sits in ADMIN_PREVIEW_PROMO_TYPES this
 * holds completely — no lock, no prizes, no notifications. Packs still accrue
 * quietly (nobody can see them), so the first post-launch tick picks up a full
 * night rather than an empty one.
 */
function authed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authed(req)) return jsonError('Unauthorized', 401);
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  // ONE-TIME piggyback (9/3, REMOVE AFTER IT FIRES): re-pay the final Hype
  // week's rank-1 prize to the override wallet (fantasycouch -> Banana69,
  // hype_payouts/_overrides). The hype-payout-sweep cron schedule was retired
  // before this re-pay could run; the payout's own per-handle create() guard
  // makes this exactly-once even though this cron ticks every minute.
  const hypeSwap = await import('@/lib/hypePayout')
    .then(({ runHypePayout }) => runHypePayout('2026-09-03', true))
    .then((r) => r.results.filter((x) => x.status !== 'already-paid').map((x) => `${x.handle}:${x.status}`))
    .catch((err) => [`FAILED: ${(err as Error).message.slice(0, 120)}`]);
  if (hypeSwap.length) logger.info('hype.final_swap_tick', { hypeSwap });
  // Jackpot-window bells ride this every-minute cron; independent of the drop
  // green-light switch and never allowed to break the drop schedule (or vice
  // versa — each is best-effort against the other).
  const jpBells = await runJpWindowBells().catch((err) => {
    logger.error('jp_window_bells.cron_failed', { err: (err as Error).message });
    return { ok: false };
  });
  // Kickoff retirement — no-op until midnight PT, once-ever after. Reads the
  // (never-deleted) per-user promo docs and credits unclaimed spins.
  const buyBonusSweep = await runBuyBonusRetirementSweep().catch((err) => {
    logger.error('buybonus_sweep.cron_failed', { err: (err as Error).message });
    return { ok: false };
  });
  // Lane rollover guard — read-only detection each tick; heals + bells Boris
  // only on the exact stuck signature (see lib/laneRolloverGuard).
  const laneGuard = await runLaneRolloverGuard().catch((err) => {
    logger.error('lane_guard.cron_failed', { err: (err as Error).message });
    return { ok: false };
  });
  // GOLDEN TICKETS backstop — locks bands the webhook missed and resolves
  // orphan bands after a Jackpot hit. No-ops entirely while its own switch
  // (system_config/zoneDrop) is off; independent of the legacy drop schedule.
  const zoneDrop = await import('@/lib/zoneDrop')
    .then(({ zoneDropTick }) => zoneDropTick())
    .catch((err) => {
      logger.error('zone_drop.cron_failed', { err: (err as Error).message });
      return { ok: false };
    });
  if (ADMIN_PREVIEW_PROMO_TYPES.includes('drop')) {
    return json({ ok: true, held: 'admin-preview', jpBells, buyBonusSweep, laneGuard, zoneDrop });
  }
  try {
    return json({ ...(await runDropSchedule(Date.now())), jpBells, buyBonusSweep, laneGuard, zoneDrop });
  } catch (err) {
    logger.error('drop.cron_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
