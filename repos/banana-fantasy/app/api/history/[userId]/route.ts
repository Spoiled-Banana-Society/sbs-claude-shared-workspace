import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getDraftHistory } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(req: Request, ctx: { params: { userId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { userId } = ctx.params;
    if (!userId) return jsonError('Missing route param: userId', 400);

    const history = await getDraftHistory(userId);
    return json(history, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
