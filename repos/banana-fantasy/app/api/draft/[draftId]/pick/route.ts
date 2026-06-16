export const dynamic = 'force-dynamic';

import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { forwardResponse } from '@/lib/api/forwardResponse';
import { jsonError, parseBody, requireString } from '@/lib/api/routeUtils';
import { walletFromSession } from '@/lib/assertSessionWallet';
import { draftsApiServer } from '@/lib/draftsApiServer';

type PickBody = {
  playerId?: string;
  displayName?: string;
  team?: string;
  position?: string;
};

export async function POST(
  req: Request,
  { params }: { params: { draftId: string } },
) {
  try {
    const session = await getPrivyUser(req);
    const wallet = walletFromSession(session);
    const body = await parseBody<PickBody>(req);

    const pick = {
      playerId: requireString(body.playerId, 'playerId'),
      displayName: requireString(body.displayName, 'displayName'),
      team: requireString(body.team, 'team'),
      position: requireString(body.position, 'position'),
    };

    const res = await draftsApiServer(
      `/draft-actions/${params.draftId}/owner/${wallet}/actions/pick`,
      { method: 'POST', wallet, body: pick },
    );
    return forwardResponse(res);
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.message, err.status);
    return jsonError('Internal server error', 500);
  }
}
