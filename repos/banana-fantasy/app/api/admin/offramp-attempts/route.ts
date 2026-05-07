// Admin-only listing of offramp/cashout attempts (Coinbase + direct).
// GET /api/admin/offramp-attempts?status=...&userId=...&limit=50
//
// Lists every cashout attempt across all paths:
//   - 'coinbase_offramp' (Coinbase hosted offramp)
//   - 'direct_usdc'      (USDC straight to user wallet)
//   - 'direct_bank'      (future: ACH bypassing Coinbase)
// Filterable by status (session_created | tx_pending | tx_completed |
// tx_failed | abandoned). Side effect of listOfframpAttempts is lazy
// abandonment marking (saves a cron).

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { listOfframpAttempts, type OfframpAttemptStatus } from '@/lib/offrampAudit';

const VALID_STATUSES: OfframpAttemptStatus[] = [
  'session_created',
  'tx_pending',
  'tx_completed',
  'tx_failed',
  'abandoned',
];

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;

  try {
    await requireAdmin(req);

    const statusRaw = getSearchParam(req, 'status');
    const userId = getSearchParam(req, 'userId') ?? undefined;
    const limitRaw = getSearchParam(req, 'limit');
    const limit = Math.min(200, Math.max(1, parseInt(limitRaw ?? '50', 10) || 50));

    let status: OfframpAttemptStatus | undefined;
    if (statusRaw) {
      if (!VALID_STATUSES.includes(statusRaw as OfframpAttemptStatus)) {
        throw new ApiError(400, `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`);
      }
      status = statusRaw as OfframpAttemptStatus;
    }

    const attempts = await listOfframpAttempts({ limit, status, userId });

    return json({ attempts, count: attempts.length });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[Admin Offramp Attempts] Error:', err);
    return jsonError('Failed to fetch offramp attempts', 500);
  }
}
