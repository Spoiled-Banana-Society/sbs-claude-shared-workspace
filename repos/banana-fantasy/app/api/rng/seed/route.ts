import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, getSearchParam } from '@/lib/api/routeUtils';
import { generateServerSeed, hashServerSeed } from '@/lib/rng';
import { createCommit, getCommit } from '@/lib/rngStore';

export const runtime = 'nodejs';

type SeedRequest = {
  contextId?: string;
};

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.rng);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody<SeedRequest>(req);
    const contextId = typeof body.contextId === 'string' && body.contextId.trim()
      ? body.contextId.trim()
      : undefined;

    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const commit = createCommit({ serverSeed, serverSeedHash, contextId });

    return json(
      {
        commitId: commit.commitId,
        serverSeedHash: commit.serverSeedHash,
        createdAt: commit.createdAt,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('RNG seed commit failed:', err);
    return jsonError('Failed to create RNG seed', 500);
  }
}

export async function GET(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.rng);
  if (rateLimited) return rateLimited;
  try {
    const commitId = getSearchParam(req, 'commitId');
    if (!commitId) throw new ApiError(400, 'Missing commitId');

    const commit = getCommit(commitId);
    if (!commit) throw new ApiError(404, 'Commit not found');

    return json(
      {
        commitId: commit.commitId,
        serverSeedHash: commit.serverSeedHash,
        createdAt: commit.createdAt,
        revealed: commit.revealed,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('RNG seed fetch failed:', err);
    return jsonError('Failed to fetch RNG seed', 500);
  }
}
