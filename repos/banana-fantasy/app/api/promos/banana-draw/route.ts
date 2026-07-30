import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getCycleLeaderboard, getRecentWinners, getBananaDrawSeatCount } from '@/lib/bananaDraw';
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
/** Rows the banner asks for when collapsed. */
const DEFAULT_LIMIT = 10;
/** Ceiling for the "See everyone" expansion. The Firestore read is the same
 *  full-collection get either way; what scales with the limit is the username
 *  resolution (one getAll batch), so this caps that batch rather than the read. */
const MAX_LIMIT = 250;

export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;

  const raw = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const [board, winners, seats] = await Promise.all([
      getCycleLeaderboard(Date.now(), limit),
      getRecentWinners(5),
      getBananaDrawSeatCount(),
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
