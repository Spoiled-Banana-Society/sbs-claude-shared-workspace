import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";

import { ApiError } from '@/lib/api/errors';
import { getSearchParam, json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { isWalletAdmin } from '@/lib/adminAllowlist';
import { getPrizeHistoryForUser } from '@/lib/prizeHistory';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.prizes);
  if (rateLimited) return rateLimited;
  const userId = getSearchParam(req, 'userId');
  if (!userId) return jsonError('Missing query param: userId', 400);

  try {
    // This is MONEY data — winnings amounts per wallet. Only the wallet's
    // own session (or an admin, for User Lookup) may read it. Server code
    // that needs the merge calls getPrizeHistoryForUser() directly.
    const { walletAddress } = await getPrivyUser(req);
    const caller = walletAddress?.toLowerCase() ?? '';
    if (caller !== userId.toLowerCase() && !isWalletAdmin(caller)) {
      return jsonError('Forbidden — you can only view your own prize history', 403);
    }

    return json(await getPrizeHistoryForUser(userId), 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('Prize history fetch failed:', err);
    return jsonError('Unable to load prize history', 503);
  }
}
