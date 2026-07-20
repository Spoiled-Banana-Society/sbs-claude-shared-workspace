export const dynamic = 'force-dynamic';
import { json, jsonError, parseBody, requireString, requireNumber } from '@/lib/api/routeUtils';
import { fillQueueRoundWithBots } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req);
    const queueType = requireString(body.queueType, 'queueType') as 'jackpot' | 'hof' | 'jackhof';
    const roundId = requireNumber(body.roundId, 'roundId');
    const botCount = typeof body.botCount === 'number' ? body.botCount : 9;

    await fillQueueRoundWithBots(queueType, roundId, botCount);
    return json({ success: true }, 200);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal Server Error', 500);
  }
}
