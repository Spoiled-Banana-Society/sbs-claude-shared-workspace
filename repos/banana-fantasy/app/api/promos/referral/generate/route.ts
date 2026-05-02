import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { generateReferralCode } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const username = typeof body.username === 'string' ? body.username : undefined;

    const result = await generateReferralCode(userId, username);
    return json(result, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
