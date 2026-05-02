import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { requireWalletAuth } from '@/lib/walletAuth';
import { markRevealed } from '@/lib/rngStore';

export const runtime = 'nodejs';

type RevealRequest = {
  commitId: string;
};

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.rng);
  if (rateLimited) return rateLimited;
  try {
    // Authenticated callers only. CommitIds are 128-bit random so guessing is
    // infeasible, but we still don't want anonymous spam against the reveal
    // state machine — and downstream features can rely on the caller being
    // identified.
    await requireWalletAuth(req);

    const body = await parseBody<RevealRequest>(req);
    const commitId = requireString(body.commitId, 'commitId');

    const commit = await markRevealed(commitId);
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
    logger.error('rng.reveal.failed', { err });
    return jsonError('Failed to reveal RNG seed', 500);
  }
}
