import { rateLimit, RATE_LIMITS } from '@/lib/rateLimit';
export const dynamic = 'force-dynamic';
import { ApiError } from '@/lib/api/errors';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { getQueueStatus, joinQueue } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyQueueJoined, notifyQueueFilled } from '@/lib/queueNotifications';
import { runInBackground } from '@/lib/serverBackground';

export async function GET() {
  try {
    const status = await getQueueStatus();
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
