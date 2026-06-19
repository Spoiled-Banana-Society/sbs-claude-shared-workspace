import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError } from '@/lib/api/routeUtils';
import { ApiError } from '@/lib/api/errors';
import { getPrivyUser } from '@/lib/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/resolve-wallet — returns the authenticated caller's wallet address.
 *
 * Why this exists: a brand-new social-login user (Google/X/email) on mobile Safari
 * can fail to get an embedded wallet surfaced in the browser `privy.user` object —
 * iOS partitions the cross-site wallet iframe storage, so Privy's local embedded
 * wallet can hang and `walletAddress` stays null on the client. Because the whole
 * login/onboarding pipeline is gated on a wallet, the header greys for ~8s then
 * reverts to "Log In" and the account is never created.
 *
 * `getPrivyUser` resolves the wallet server-side via the Privy User API (its
 * social-login fallback, lib/auth.ts), which is NOT subject to browser storage
 * partitioning. The client calls this ONLY when its own wallet derivation comes
 * up empty, which unblocks account creation on mobile. Nothing here is
 * client-claimed — the wallet is derived from the verified Privy token, so it
 * can't be spoofed.
 */
export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { walletAddress } = await getPrivyUser(req);
    return json({ wallet: walletAddress ?? null });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('auth.resolve_wallet.failed', { err });
    return jsonError('Internal Server Error', 500);
  }
}
