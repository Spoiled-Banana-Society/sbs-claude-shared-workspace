/**
 * Admin: award (or re-check) a gameweek's top-5 prizes. Used to resolve a tie the cron refused:
 *   POST { gameweek: "2026REG-01", dryRun?: true, winners?: [{ place: 1, tokenId: "6335" }, …5 rows] }
 */
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminAction } from '@/lib/adminAudit';
import { getRequestId } from '@/lib/requestId';
import { awardWeeklyPrizes } from '@/lib/cardWinnings';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await parseBody<{ gameweek?: string; dryRun?: boolean; winners?: Array<{ place: number; tokenId: string }> }>(req);
    const gameweek = requireString(body.gameweek, 'gameweek').trim();
    if (!/^\d{4}REG-\d{2}$/.test(gameweek)) return jsonError('gameweek must look like 2026REG-01', 400);
    const winners = Array.isArray(body.winners) && body.winners.length ? body.winners.map((w) => ({ place: Number(w.place), tokenId: String(w.tokenId) })) : undefined;
    const result = await awardWeeklyPrizes(gameweek, { dryRun: body.dryRun === true, winners, source: `admin:${admin.walletAddress ?? admin.userId}` });
    if (result.status === 'awarded') {
      await logAdminAction({ requestId: getRequestId(req), actor: admin.walletAddress ?? admin.userId, action: 'weekly-prizes-award', target: gameweek, after: { winners: result.winners.map((w) => `${w.place}:${w.tokenId}:$${w.amount}`) } });
    }
    return json(result);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError((err as Error).message || 'Weekly prize award failed', 500);
  }
}
