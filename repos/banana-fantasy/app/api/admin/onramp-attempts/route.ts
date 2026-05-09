// Admin-only listing of Coinbase / MoonPay onramp purchase attempts.
// GET /api/admin/onramp-attempts?status=...&provider=...&userId=...&limit=50

export const dynamic = 'force-dynamic';

import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { requireAdmin } from '@/lib/adminAuth';
import { listOnrampAttempts, type OnrampAttemptStatus, type OnrampProvider } from '@/lib/onrampAudit';

const VALID_STATUSES: OnrampAttemptStatus[] = [
  'session_created',
  'tx_pending',
  'tx_completed',
  'tx_failed',
  'abandoned',
];

const VALID_PROVIDERS: OnrampProvider[] = ['coinbase', 'moonpay'];

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.admin);
  if (rateLimited) return rateLimited;
  try {
    await requireAdmin(req);

    const statusRaw = getSearchParam(req, 'status');
    const providerRaw = getSearchParam(req, 'provider');
    const userId = getSearchParam(req, 'userId') ?? undefined;
    const limitRaw = getSearchParam(req, 'limit');
    const limit = Math.min(200, Math.max(1, parseInt(limitRaw ?? '50', 10) || 50));

    let status: OnrampAttemptStatus | undefined;
    if (statusRaw) {
      if (!VALID_STATUSES.includes(statusRaw as OnrampAttemptStatus)) {
        throw new ApiError(400, `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`);
      }
      status = statusRaw as OnrampAttemptStatus;
    }
    let provider: OnrampProvider | undefined;
    if (providerRaw) {
      if (!VALID_PROVIDERS.includes(providerRaw as OnrampProvider)) {
        throw new ApiError(400, `Invalid provider. Allowed: ${VALID_PROVIDERS.join(', ')}`);
      }
      provider = providerRaw as OnrampProvider;
    }

    const attempts = await listOnrampAttempts({ limit, status, provider, userId });
    return json({ attempts, count: attempts.length });
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('[Admin Onramp Attempts] Error:', err);
    return jsonError('Failed to fetch onramp attempts', 500);
  }
}
