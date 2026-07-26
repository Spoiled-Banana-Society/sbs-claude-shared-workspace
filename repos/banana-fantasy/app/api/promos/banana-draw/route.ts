import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getCycleLeaderboard, getRecentWinners, getJackhofSeatCount } from '@/lib/bananaDraw';
import { logger } from '@/lib/logger';

/**
 * GET /api/promos/banana-draw — public Banana Draw state.
 *
 * Deliberately AUTH-FREE and user-agnostic: this powers the leaderboard banner
 * pinned to the top of /promos, which Boris wants everyone to see. Personal
 * numbers (your Bananas, your odds, your history) are NOT here — they ride on
 * the authenticated /api/promos payload. Nothing returned identifies a user
 * beyond the wallet already public in every draft lobby and the proof feed.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;

  try {
    const [board, winners, seats] = await Promise.all([
      getCycleLeaderboard(Date.now(), 10),
      getRecentWinners(5),
      getJackhofSeatCount(),
    ]);

    return json({
      cycleId: board.cycle.cycleId,
      closesAt: board.cycle.closesAt,
      totalBananas: board.totalBananas,
      entrantCount: board.entrantCount,
      leaderboard: board.rows,
      recentWinners: winners,
      seatsClaimed: seats.claimed,
      seatsTotal: seats.total,
    });
  } catch (err) {
    logger.error('banana.public_state_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
