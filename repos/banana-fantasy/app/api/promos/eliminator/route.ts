import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { json, jsonError } from '@/lib/api/routeUtils';
import { getLeaderboard } from '@/lib/eliminator';
import { logger } from '@/lib/logger';

/**
 * GET /api/promos/eliminator — public Eliminator state.
 *
 * Powers the leaderboard pinned to the top of /promos. Same stance as the
 * Banana Draw route it succeeds: AUTH-FREE, so everyone sees the board whether
 * they're logged in or not — the board IS the promo, and hiding it behind login
 * would kill the thing that makes people come back.
 *
 * `?wallet=` is an OPTIONAL viewer hint used only to add that wallet's own row
 * ("you're #11, 26 Bananas from a seat"). Nothing returned identifies a user
 * beyond the wallet already public in every draft lobby and the proof feed, and
 * passing someone else's wallet reveals only their public standing.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;

  const wallet = new URL(req.url).searchParams.get('wallet') ?? undefined;

  try {
    const board = await getLeaderboard(wallet || undefined, Date.now());
    return json(board);
  } catch (err) {
    logger.error('eliminator.public_state_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
