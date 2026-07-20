export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { updateQueueRoundStatus } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const queueType = requireString(body.queueType, 'queueType') as 'jackpot' | 'hof' | 'jackhof';
    const roundId = typeof body.roundId === 'number' ? body.roundId : parseInt(String(body.roundId), 10);
    const status = requireString(body.status, 'status') as 'filling' | 'ready' | 'drafting' | 'completed';

    if (!['jackpot', 'hof', 'jackhof'].includes(queueType)) return jsonError('Invalid queueType', 400);
    if (!['filling', 'ready', 'drafting', 'completed'].includes(status)) return jsonError('Invalid status', 400);
    if (isNaN(roundId)) return jsonError('Invalid roundId', 400);

    await updateQueueRoundStatus(queueType, roundId, status);
    return json({ success: true }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
