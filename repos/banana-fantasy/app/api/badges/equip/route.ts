import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser, linkedWalletsOf } from '@/lib/privyServer';
import { equipBadge } from '@/lib/db';

/**
 * POST /api/badges/equip
 * Body: { badgeId: string | null }   (null clears the equipped badge)
 *
 * Privy-authed. Sets the equipped badge on the caller's user doc. The
 * server-side equipBadge validates the badge is unlocked — clients can't
 * equip something they haven't earned.
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;

  try {
    const user = await getPrivyUser(req);
    let wallet = user.walletAddress;

    // Privy social-login JWTs don't always carry the wallet — fall back
    // to the server-side Privy user lookup to find any linked wallet.
    if (!wallet) {
      const privyUser = await fetchPrivyUser(user.userId);
      const linked = privyUser ? linkedWalletsOf(privyUser) : [];
      wallet = linked[0] || null;
    }
    if (!wallet) throw new ApiError(401, 'No wallet linked to this account');

    const body = await parseBody(req);
    const badgeId = body.badgeId === null ? null : (typeof body.badgeId === 'string' ? body.badgeId : undefined);
    if (badgeId === undefined) throw new ApiError(400, 'badgeId required (string or null)');

    const result = await equipBadge(wallet.toLowerCase(), badgeId);
    if (!result.ok) throw new ApiError(400, result.reason || 'equip failed');

    return json({ ok: true, equipped: badgeId }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
