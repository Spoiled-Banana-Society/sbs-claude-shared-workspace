import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';

import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';
import { getCurrentPeriod, toPublicSummary } from '@/lib/wheelPeriod';
import { getWheelProofContractAddress } from '@/lib/wheelProofContract';

/**
 * GET /api/wheel/period — public read of the currently-active wheel
 * verification period. Used by the wheel page banner to show "Period N
 * sealed by Chainlink VRF + Merkle root, X/10000 spins verified".
 *
 * Returns null fields when no period exists yet (pre-bootstrap state):
 * the wheel still functions, it just won't return Merkle proofs with
 * spins until an admin runs /api/admin/wheel-period/open.
 */
export async function GET(req: Request) {
  // Polled by the wheel proof banner — general limit (60/min), not the tight
  // spin bucket, so polling doesn't eat the user's spin budget.
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const period = await getCurrentPeriod();
    const contractAddress = await getWheelProofContractAddress();
    if (!period) {
      return json({ active: false, period: null, contractAddress }, 200);
    }
    return json({ active: period.status === 'active', period: toPublicSummary(period), contractAddress }, 200);
  } catch (err) {
    logger.error('wheel.period.public_read_failed', { err });
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
