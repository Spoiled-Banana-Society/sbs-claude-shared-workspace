export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError, parseBody } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

type PatchPreferencesBody = {
  autoDraft?: boolean;
};

export async function GET(
  _req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(_req);
    const wallet = walletFromSession(session);
    const res = await draftsApiServer(
      `/draft-actions/${params.draftId}/owner/${wallet}/preferences`,
      { wallet },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    const body = await parseBody<PatchPreferencesBody>(req);
    if (typeof body.autoDraft !== 'boolean') {
      throw new ApiError(400, 'autoDraft (boolean) is required');
    }

    const res = await draftsApiServer(
      `/draft-actions/${params.draftId}/owner/${wallet}/preferences`,
      { method: 'PATCH', wallet, body: { autoDraft: body.autoDraft } },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
