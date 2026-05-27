/**
 * GET /api/dms/blocks → list the wallets the caller has blocked, with profiles.
 *
 * Used by the "Blocked" panel in the Messages hub so the user can see
 * who they've blocked and unblock them.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { getBlockedUsers } from '@/lib/dms';
import { getPublicUsers } from '@/lib/friends';

export async function GET(req: Request) {
  try {
    const user = await getPrivyUser(req);
    if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    const wallets = await getBlockedUsers(user.walletAddress);
    if (wallets.length === 0) return NextResponse.json({ blocked: [] });
    const profiles = await getPublicUsers(wallets);
    const blocked = wallets.map((w) => profiles.get(w) ?? { walletAddress: w, username: w.slice(0, 8) });
    return NextResponse.json({ blocked });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
