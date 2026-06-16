export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError, parseBody } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

type JoinBody = {
  speed?: string;
  numLeaguesToJoin?: number;
  draftType?: string;
  passType?: string;
};

function parseSpeed(speed: unknown): 'fast' | 'slow' {
  if (speed === 'fast' || speed === 'slow') return speed;
  throw new ApiError(400, 'speed must be "fast" or "slow"');
}

export async function POST(req: Request) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    const body = await parseBody<JoinBody>(req);
    const speed = parseSpeed(body.speed);

    const goBody: Record<string, unknown> = {
      numLeaguesToJoin:
        typeof body.numLeaguesToJoin === 'number' && body.numLeaguesToJoin > 0
          ? body.numLeaguesToJoin
          : 1,
    };
    if (body.draftType) goBody.draftType = body.draftType;
    if (body.passType) goBody.passType = body.passType;

    const res = await draftsApiServer(`/league/${speed}/owner/${wallet}`, {
      method: 'POST',
      wallet,
      body: goBody,
    });
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
