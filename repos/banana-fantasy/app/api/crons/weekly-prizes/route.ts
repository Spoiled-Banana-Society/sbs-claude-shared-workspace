/**
 * Weekly top-5 prize awarder (Boris 2026-09-14). Vercel cron, Tuesdays hourly 4am–12pm PT
 * (vercel.json `0 11-19 * * 2`) — the season clock rolls at 3am PT Tuesday, so by the first run
 * the previous week is closed and the scorer has applied every final. Idempotent: weekly_awards/{gw}.
 *
 * Manual (admin JWT): GET /api/crons/weekly-prizes?gameweek=2026REG-01&dry=1
 */
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { recordCronHeartbeat } from '@/lib/cronHeartbeat';
import { awardWeeklyPrizes, previousGameweek } from '@/lib/cardWinnings';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const isCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    try { await requireAdmin(req); } catch { return jsonError('Unauthorized', 401); }
  }
  const gameweek = getSearchParam(req, 'gameweek') || previousGameweek();
  if (!gameweek) return json({ status: 'skipped', reason: 'no finished week yet' });
  const dryRun = getSearchParam(req, 'dry') === '1';
  try {
    const result = await awardWeeklyPrizes(gameweek, { dryRun, source: isCron ? 'cron' : 'admin' });
    if (!dryRun) await recordCronHeartbeat('weekly-prizes', { gameweek, status: result.status });
    return json(result);
  } catch (err) {
    logger.error('weekly_prizes.failed', { gameweek, err: String(err) });
    return jsonError(`Weekly prize run failed: ${(err as Error).message}`, 500);
  }
}
