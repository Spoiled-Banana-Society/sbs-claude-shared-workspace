import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireNumber, requireString } from '@/lib/api/routeUtils';
import { computeResult, generateClientSeed, generateServerSeed, hashServerSeed, resultToIndex } from '@/lib/rng';
import { createCommit } from '@/lib/rngStore';

export const runtime = 'nodejs';

type DraftOrderRequest = {
  draftId: string;
  playerCount: number;
  clientSeed?: string;
  nonce?: number;
};

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.rng);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody<DraftOrderRequest>(req);
    const draftId = requireString(body.draftId, 'draftId');
    const playerCount = requireNumber(body.playerCount, 'playerCount');

    if (!Number.isInteger(playerCount) || playerCount < 2) {
      throw new ApiError(400, 'playerCount must be an integer >= 2');
    }

    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const commit = createCommit({ serverSeed, serverSeedHash, contextId: draftId });

    const clientSeed = typeof body.clientSeed === 'string' && body.clientSeed.trim()
      ? body.clientSeed.trim()
      : generateClientSeed(draftId);

    let nonce = typeof body.nonce === 'number' && Number.isInteger(body.nonce) ? body.nonce : 0;

    const order = Array.from({ length: playerCount }, (_, i) => i + 1);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const hash = computeResult(serverSeed, clientSeed, nonce);
      const j = resultToIndex(hash, i + 1);
      [order[i], order[j]] = [order[j], order[i]];
      nonce += 1;
    }

    return json(
      {
        draftId,
        order,
        commitId: commit.commitId,
        serverSeedHash: commit.serverSeedHash,
        clientSeed,
        nonceStart: typeof body.nonce === 'number' ? body.nonce : 0,
        nonceEnd: nonce,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    console.error('RNG draft order failed:', err);
    return jsonError('Failed to generate draft order', 500);
  }
}
