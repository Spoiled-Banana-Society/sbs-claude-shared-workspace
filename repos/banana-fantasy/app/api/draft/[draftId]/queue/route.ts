export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

export async function GET(
  _req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(_req);
    const wallet = walletFromSession(session);
    const res = await draftsApiServer(
      `/owner/${wallet}/drafts/${params.draftId}/state/queue`,
      { wallet },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    let queue: unknown;
    try {
      queue = await req.json();
    } catch {
      throw new ApiError(400, 'Invalid JSON body');
    }
    if (!Array.isArray(queue)) {
      throw new ApiError(400, 'Queue must be an array');
    }

    const res = await draftsApiServer(
      `/owner/${wallet}/drafts/${params.draftId}/state/queue`,
      { method: 'POST', wallet, body: queue },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
