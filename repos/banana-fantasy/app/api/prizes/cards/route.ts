/**
 * GET /api/prizes/cards?userId=0x… — cards the caller currently owns (on-chain) that have weekly
 * prize money sitting on them. Auth: the caller's own wallet (or an admin). No KYC involved.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { getCardWinningsForOwner } from '@/lib/cardWinnings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  const userId = (getSearchParam(req, 'userId') || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(userId)) return jsonError('userId must be a wallet address', 400);
  try {
    const { walletAddress } = await getPrivyUser(req);
    const caller = walletAddress?.toLowerCase() ?? '';
    if (caller !== userId && !isWalletAdmin(caller)) return jsonError('Forbidden', 403);
    const cards = await getCardWinningsForOwner(userId);
    const total = Math.round(cards.reduce((s, c) => s + c.onCard, 0) * 100) / 100;
    return json({ cards, total }, { status: 200, headers: { 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Unable to load card winnings', 503);
  }
}
