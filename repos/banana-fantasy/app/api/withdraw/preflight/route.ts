/**
 * POST /api/withdraw/preflight
 *
 * Gate for the self-custody cash-out flow (user sends their own USDC on Base to
 * their own Coinbase/wallet address). Same KYC + jurisdiction checks as the old
 * Coinbase off-ramp — we keep ID verification even though the funds are the
 * user's own crypto. Returns:
 *
 *   { ok: true }                              → clear to withdraw
 *   403 { requiresVerification: 'kyc' }       → must finish Didit first
 *   403 { blocked, error, blockCode }         → jurisdiction/age block
 */

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getPrivyUser } from '@/lib/auth';
import { getPersonaVerification } from '@/lib/db-firestore';
import { checkBlockRules } from '@/lib/verifyBlockRules';

export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.prizes);
  if (limited) return limited;

  try {
    const session = await getPrivyUser(req);
    const verificationKey = (session.walletAddress ?? session.userId).toLowerCase();
    const verification = await getPersonaVerification(verificationKey);

    if (!verification.tier1.verified) {
      return json({ error: 'Identity verification required', requiresVerification: 'kyc' }, 403);
    }

    const blockResult = checkBlockRules(verification.verifiedIdentity);
    if (blockResult.blocked) {
      return json(
        {
          error: blockResult.message || 'Withdrawal not permitted in your jurisdiction.',
          blocked: true,
          blockCode: blockResult.code,
          blockDetail: blockResult.detail,
        },
        403,
      );
    }

    return json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Preflight failed', 500);
  }
}
