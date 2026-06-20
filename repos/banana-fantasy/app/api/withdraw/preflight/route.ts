/**
 * POST /api/withdraw/preflight
 *
 * Gate for the self-custody Balance cash-out flow (user sends their OWN USDC on
 * Base to their own Coinbase/wallet address).
 *
 * Product decision (2026-06-20): Balance is the user's own wallet money — it
 * needs NO ID check. Only WINNINGS payouts require KYC, and that's enforced
 * separately in the prize-withdrawal flow (useWithdraw → withdrawAll), NOT here.
 * We still require an authenticated session.
 *
 *   { ok: true }   → clear to withdraw
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';

export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  try {
    // Require a valid session, but no KYC/jurisdiction gate — it's their money.
    await getPrivyUser(req);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Preflight failed', 500);
  }
}
