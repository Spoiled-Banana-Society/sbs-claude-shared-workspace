import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { claimPromo } from '@/lib/db';
import { logger } from '@/lib/logger';
import { LOG_SOURCES } from '@/lib/logSources';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const promoId = requireString(body.promoId, 'promoId');

    const result = await claimPromo(userId, promoId);
    return json(result, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    logger.error(LOG_SOURCES.promo.CLAIM_FAILED, {
      err: (err as Error).message,
      stack: (err as Error).stack,
    });
    return jsonError('Internal Server Error', 500);
  }
}
