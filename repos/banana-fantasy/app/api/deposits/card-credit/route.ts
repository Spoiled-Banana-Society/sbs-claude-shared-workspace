export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody } from '@/lib/api/routeUtils';
import { paymentsEnabled } from '@/lib/envGates';
import { getPrivyUser } from '@/lib/auth';
import { fetchPrivyUser, isEmbeddedWalletOf, linkedWalletsOf } from '@/lib/privyServer';
import { creditCardDeposit } from '@/lib/purchases/creditCardDeposit';
import { logger } from '@/lib/logger';

/**
 * POST /api/deposits/card-credit
 * Body: { amountUsd: number }  — the Add Funds amount the user received.
 *
 * Privy-authed. Deposit bankroll: accrues the MoonPay card fee of a verified
 * wallet deposit toward the card-fee → free-draft reward (and the fronted
 * first-purchase bonus), at DEPOSIT time instead of pass-purchase time
 * (Richard 2026-07-21). All verification + credit semantics live in
 * creditCardDeposit — the transfer must exist on-chain, land in the caller's
 * wallet, and be previously uncredited. Idempotent: retries and double-submits
 * return credited:false instead of double-crediting.
 *
 * Dark with the rest of the feature: 404s unless NEXT_PUBLIC_DEPOSIT_ENABLED
 * is 'true' (same flag the client gates on — it's public config, readable
 * server-side too).
 */
export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.purchases);
  if (rateLimited) return rateLimited;

  try {
    if (process.env.NEXT_PUBLIC_DEPOSIT_ENABLED !== 'true') {
      throw new ApiError(404, 'Not found');
    }
    if (!paymentsEnabled()) {
      throw new ApiError(503, 'Payments are disabled');
    }

    const user = await getPrivyUser(req);
    const privyUser = await fetchPrivyUser(user.userId);
    let wallet = user.walletAddress;
    // Privy social-login JWTs don't always carry the wallet — fall back to the
    // server-side Privy user lookup (same pattern as badges/equip).
    if (!wallet) {
      const linked = privyUser ? linkedWalletsOf(privyUser) : [];
      wallet = linked[0] || null;
    }
    if (!wallet) throw new ApiError(401, 'No wallet linked to this account');

    // WEB2 ONLY (Richard 2026-07-21): the card-fee credit models MoonPay fees
    // on the embedded-wallet onramp. External-wallet (web3) users fund their
    // wallets themselves — an inbound transfer proves nothing about card fees,
    // so they never accrue deposit credit or the fronted bonus here.
    if (!privyUser || !isEmbeddedWalletOf(privyUser, wallet)) {
      throw new ApiError(403, 'Card-fee credit applies to embedded-wallet card deposits only');
    }

    const body = await parseBody(req);
    const amountUsd = Number(body.amountUsd);

    const result = await creditCardDeposit({ wallet, claimedAmountUsd: amountUsd });
    return json(result);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('depositCredit.route_failed', { err: (err as Error).message });
    return jsonError('Deposit credit failed', 500);
  }
}
