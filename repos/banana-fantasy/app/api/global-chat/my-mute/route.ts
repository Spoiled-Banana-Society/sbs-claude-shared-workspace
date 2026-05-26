/**
 * GET /api/global-chat/my-mute
 *
 * Returns the caller's active mute, or `{ mute: null }` if not muted.
 * Used by the client to disable the input + show "you're muted until …".
 *
 * The POST /api/global-chat endpoint also enforces this server-side; this
 * route is purely UX so the user gets an immediate "you can't type" state
 * instead of typing a long message and getting it rejected.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { getActiveMute } from '@/lib/globalChat';

export async function GET(req: Request) {
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress) {
      return NextResponse.json({ mute: null });
    }
    const mute = await getActiveMute(user.walletAddress);
    return NextResponse.json({ mute });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
