/**
 * POST /api/prizes/transfer { userId, tokenIds?: string[] } — move weekly prize money from the
 * caller's card(s) into their site balance (pending prize records on /winnings). Omit tokenIds to
 * sweep every card they own with money on it. Ownership is checked on-chain per card. No KYC here —
 * that gate lives on withdraw (/api/prizes/withdraw-all), where money actually leaves us.
 */
import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { transferCardWinnings } from '@/lib/cardWinnings';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody<{ userId?: string; tokenIds?: unknown }>(req);
    const userId = requireString(body.userId, 'userId').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(userId)) return jsonError('userId must be a wallet address', 400);
    const { walletAddress } = await getPrivyUser(req);
    if (!walletAddress || walletAddress.toLowerCase() !== userId) return jsonError('Forbidden — you can only transfer your own winnings', 403);
    const tokenIds = Array.isArray(body.tokenIds) ? body.tokenIds.map(String).filter((t) => /^\d+$/.test(t)) : undefined;
    const result = await transferCardWinnings(userId, tokenIds);
    return json(result);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('card_winnings.transfer_failed', { err: String(err) });
    return jsonError('Transfer failed — nothing was moved. Try again.', 500);
  }
}
