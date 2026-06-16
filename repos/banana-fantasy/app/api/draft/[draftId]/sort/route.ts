export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

type SortBody = {
  sortBy?: string;
};

export async function GET(
  _req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(_req);
    const wallet = walletFromSession(session);
    const res = await draftsApiServer(
      `/owner/${wallet}/drafts/${params.draftId}/state/sort`,
      { wallet },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    const body = await parseBody<SortBody>(req);
    const sortBy = requireString(body.sortBy, 'sortBy');

    const res = await draftsApiServer(
      `/owner/${wallet}/drafts/${params.draftId}/state/sort/${sortBy}`,
      { method: 'PUT', wallet },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
