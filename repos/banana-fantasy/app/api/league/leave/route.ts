export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

type LeaveBody = {
  draftId?: string;
  tokenId?: string;
};

export async function POST(req: Request) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    const body = await parseBody<LeaveBody>(req);
    const draftId = requireString(body.draftId, 'draftId');
    const tokenId = typeof body.tokenId === 'string' ? body.tokenId : '';

    const res = await draftsApiServer(`/league/${draftId}/actions/leave`, {
      method: 'POST',
      wallet,
      body: { ownerId: wallet, tokenId },
    });
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
