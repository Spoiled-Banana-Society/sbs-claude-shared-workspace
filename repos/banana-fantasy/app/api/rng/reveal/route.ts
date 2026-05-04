import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { markRevealed } from '@/lib/rngStore';

export const runtime = 'nodejs';

type RevealRequest = {
  commitId: string;
};

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.rng);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody<RevealRequest>(req);
    const commitId = requireString(body.commitId, 'commitId');

    const commit = markRevealed(commitId);
    if (!commit) throw new ApiError(404, 'Commit not found');

    return json(
      {
        commitId: commit.commitId,
        serverSeed: commit.serverSeed,
        serverSeedHash: commit.serverSeedHash,
        revealedAt: Date.now(),
      },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('RNG seed reveal failed:', err);
    return jsonError('Failed to reveal RNG seed', 500);
  }
}
