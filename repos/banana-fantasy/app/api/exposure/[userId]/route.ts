import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError } from '@/lib/api/routeUtils';
import { getExposure, recomputeUserExposure } from '@/lib/db';

// Stored UserExposure docs that match the static seed shape — totalDrafts=20
// + the seed sentinel username — get force-recomputed on first read so
// existing users with stale seed data are backfilled without needing
// another draft completion.
const SEED_SENTINEL_USERNAME = 'BananaKing99';
const SEED_TOTAL_DRAFTS = 20;

export async function GET(req: Request, ctx: { params: { userId: string } }) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const { userId } = ctx.params;
    if (!userId) return jsonError('Missing route param: userId', 400);

    let exposure = await getExposure(userId);
    const isSeed = exposure
      && exposure.username === SEED_SENTINEL_USERNAME
      && exposure.totalDrafts === SEED_TOTAL_DRAFTS;
    const force = req.url.includes('recompute=1');

    if (force || isSeed || !exposure) {
      const recomputed = await recomputeUserExposure(userId);
      if (recomputed) exposure = recomputed;
    }

    if (!exposure) return jsonError('Exposure not found', 404);
    return json(exposure, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error(err);
    return jsonError('Internal Server Error', 500);
  }
}
