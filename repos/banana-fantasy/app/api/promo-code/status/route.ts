import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { json, jsonError, getSearchParam } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/promo-code/status[?wallet=0x…]
 * Ships dark: { active:false } while the switch is off. Never returns the code.
 * With a wallet: whether THIS account has redeemed / is eligible.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.general);
  if (limited) return limited;
  try {
    const wallet = (getSearchParam(req, 'wallet') ?? '').toLowerCase();
    const { getPromoCodeStatus } = await import('@/lib/promoCode');
    return json(await getPromoCodeStatus(wallet || undefined), 200);
  } catch (err) {
    logger.warn('promo_code.status_failed', { err: (err as Error).message });
    return jsonError('Internal Server Error', 500);
  }
}
