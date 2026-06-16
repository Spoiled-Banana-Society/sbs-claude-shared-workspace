export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError, parseBody } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

type MintBody = {
  minId?: number;
  maxId?: number;
  numberOfTokens?: number;
  promoCode?: string;
};

function buildMintPayload(body: MintBody): { minId: number; maxId: number; promoCode?: string } {
  if (typeof body.minId === 'number' && typeof body.maxId === 'number') {
    if (body.maxId < body.minId) {
      throw new ApiError(400, 'maxId must be >= minId');
    }
    return {
      minId: body.minId,
      maxId: body.maxId,
      ...(typeof body.promoCode === 'string' && body.promoCode ? { promoCode: body.promoCode } : {}),
    };
  }

  if (typeof body.numberOfTokens === 'number' && body.numberOfTokens >= 1) {
    const minId = Date.now();
    return {
      minId,
      maxId: minId + body.numberOfTokens - 1,
      ...(typeof body.promoCode === 'string' && body.promoCode ? { promoCode: body.promoCode } : {}),
    };
  }

  throw new ApiError(400, 'minId/maxId or numberOfTokens is required');
}

export async function POST(req: Request) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    const body = await parseBody<MintBody>(req);
    const mintBody = buildMintPayload(body);

    const res = await draftsApiServer(`/owner/${wallet}/draftToken/mint`, {
      method: 'POST',
      wallet,
      body: mintBody,
    });
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
