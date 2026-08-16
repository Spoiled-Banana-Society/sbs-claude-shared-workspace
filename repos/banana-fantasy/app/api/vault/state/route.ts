import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { getVaultCardState } from '@/lib/bananaVault';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
    const state = await getVaultCardState(/^0x[0-9a-f]{40}$/.test(wallet) ? wallet : null);
    if (!state) return json({ open: false }, 200);
    return json(state, 200);
  } catch (err) {
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
