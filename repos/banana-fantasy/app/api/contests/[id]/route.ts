import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getContest } from '@/lib/db';

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { id } = ctx.params;
    if (!id) return jsonError('Missing route param: id', 400);

    const contest = await getContest(id);
    if (!contest) return jsonError('Contest not found', 404);

    return json(contest, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
