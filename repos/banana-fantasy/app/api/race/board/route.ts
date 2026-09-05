/**
 * GET /api/race/board?wallet=0x… — the Banana Race leaderboard (lib/bananaRace.ts).
 *
 * Returns { enabled:false } and nothing else while the switch is off, so the
 * page and the home tile render nothing pre-launch. With ?wallet= the
 * viewer's own row is pinned ("You: 7 points · #14 · 4 behind the cutoff").
 *
 * Read-only, cached 45s server-side; the page polls once a minute. No writes,
 * no fan-out per viewer (Rule #0).
 */
import { isFirestoreConfigured } from '@/lib/firebaseAdmin';
import { buildRaceBoard } from '@/lib/bananaRace';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isFirestoreConfigured()) return jsonError('Firestore not configured', 503);
  try {
    const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
    const viewer = /^0x[0-9a-f]{40}$/.test(wallet) ? wallet : null;
    const board = await buildRaceBoard(viewer);
    if (!board.enabled) return json({ enabled: false });
    return json(board, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    logger.error('banana_race.board_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
