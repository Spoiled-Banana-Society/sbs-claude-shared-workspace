// Admin-only listing of KYC verification attempts.
// GET /api/admin/kyc-attempts?status=...&userId=...&limit=50
//
// Returns the most recent attempts (descending by timestamp), filterable by:
//   - status: approved | didit_declined | name_mismatch | dob_mismatch |
//             blocked | error | invalid_input
//   - userId: filter to a specific user
//   - limit: max 200, default 50
//
// Used by the admin dashboard to surface who passed/failed KYC, what stage
// they got stuck at, and (via identityHash) detect multi-account attempts.

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { listKycAttempts, type KycAttemptStatus } from '@/lib/kycAudit';

const VALID_STATUSES: KycAttemptStatus[] = [
  'approved',
  'didit_declined',
  'name_mismatch',
  'dob_mismatch',
  'blocked',
  'error',
  'invalid_input',
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

    let status: KycAttemptStatus | undefined;
    if (statusRaw) {
      if (!VALID_STATUSES.includes(statusRaw as KycAttemptStatus)) {
        throw new ApiError(400, `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`);
      }
      status = statusRaw as KycAttemptStatus;
    }

    const attempts = await listKycAttempts({ limit, status, userId });

    return json({ attempts, count: attempts.length });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[Admin KYC Attempts] Error:', err);
    return jsonError('Failed to fetch KYC attempts', 500);
  }
}
