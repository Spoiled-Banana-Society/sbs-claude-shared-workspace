import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getQueueStatus, joinQueue } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyQueueJoined, notifyQueueFilled } from '@/lib/queueNotifications';
import { runInBackground } from '@/lib/serverBackground';

// Short-TTL cache of on-chain ownerOf() lookups so the 5s queue poll (from many
// clients) doesn't hammer the Base RPC. tokenId → { owner, at }. Per-lambda.
const ownerCache = new Map<string, { owner: string | null; at: number }>();
const OWNER_TTL_MS = 30_000;

async function resolveOwnerCached(tokenId: string): Promise<string | null> {
  const hit = ownerCache.get(tokenId);
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return hit.owner;
  const { getOnchainOwner } = await import('@/lib/onchain/ownerOf');
  const owner = await getOnchainOwner(tokenId);
  ownerCache.set(tokenId, { owner, at: Date.now() });
  return owner;
}

/**
 * The slot follows the NFT. A wheel-won JP/HOF pass queue member carries a
 * tokenId; whoever owns that token RIGHT NOW is the real member — not whatever
 * wallet was recorded at join/last-reassign. Overlay the current on-chain owner
 * so the drafting lobby shows the draft to the buyer and hides it from the seller
 * the instant a sale settles, with zero reliance on a client reassign call.
 * Best-effort: a failed chain read leaves the recorded wallet untouched.
 */
async function overlayOnchainOwners(status: Record<string, { rounds?: Array<{ status?: string; members?: Array<{ wallet?: string; tokenId?: string }> }> }>): Promise<void> {
  const tokenIds = new Set<string>();
  for (const q of Object.values(status)) {
    for (const r of q.rounds || []) {
      if (r.status === 'completed') continue;
      for (const m of r.members || []) if (m.tokenId) tokenIds.add(String(m.tokenId));
    }
  }
  if (!tokenIds.size) return;
  const owners = new Map<string, string | null>();
  await Promise.all([...tokenIds].map(async (tid) => { owners.set(tid, await resolveOwnerCached(tid)); }));
  for (const q of Object.values(status)) {
    for (const r of q.rounds || []) {
      if (r.status === 'completed') continue;
      for (const m of r.members || []) {
        if (!m.tokenId) continue;
        const owner = owners.get(String(m.tokenId));
        if (owner && owner.toLowerCase() !== (m.wallet || '').toLowerCase()) m.wallet = owner;
      }
    }
  }
}

export async function GET() {
  try {
    const status = await getQueueStatus();
    try { await overlayOnchainOwners(status as Parameters<typeof overlayOnchainOwners>[0]); }
    catch (e) { logger.warn('draft.queues.owner_overlay_failed', { err: (e as Error).message }); }
    return json(status, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('draft.queues.unhandled', { err, context: { op: 'status' } });
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}

export async function POST(req: Request) {
  const rateLimited = rateLimit(req, RATE_LIMITS.general);
  if (rateLimited) return rateLimited;
  try {
    const body = await parseBody(req);
    const userId = requireString(body.userId, 'userId');
    const queueType = requireString(body.queueType, 'queueType') as 'jackpot' | 'hof';

    if (queueType !== 'jackpot' && queueType !== 'hof') {
      return jsonError('Invalid queue type', 400);
    }

    const queue = await joinQueue(userId, queueType);

    // Notifications — waitUntil-backed so they SURVIVE the response (a bare
    // .catch() detaches the promise, which dies with the frozen lambda; queue
    // notis were silently lost that way).
    const userRounds = queue.rounds.filter(r => r.status === 'filling' && r.members.some(m => m.wallet === userId)).length;
    if (userRounds > 0) {
      runInBackground('queue.notify-joined', notifyQueueJoined(userId, queueType, userRounds));
    }
    // Notify all members of any rounds that just filled
    for (const r of queue.rounds) {
      if (r.status === 'ready' && r.members.length >= 10) {
        runInBackground('queue.notify-filled', notifyQueueFilled(r.members.map(m => m.wallet), queueType));
      }
    }

    return json({ queue }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    logger.error('draft.queues.unhandled', { err, context: { op: 'join' } });
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
}
