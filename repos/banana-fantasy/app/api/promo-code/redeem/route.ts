import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** POST /api/promo-code/redeem { userId, code } — see lib/promoCode.ts. */
export async function POST(req: Request) {
  const limited = rateLimit(req, RATE_LIMITS.wheel);
  if (limited) return limited;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const code = requireString(body.code, 'code');
    const { redeemPromoCode } = await import('@/lib/promoCode');
    const result = await redeemPromoCode(userId, code);
    return json({ ok: true, ...result }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('promo_code.redeem_failed', { err: (err as Error).message, stack: (err as Error).stack });
    return jsonError('Internal Server Error', 500);
  }
}
