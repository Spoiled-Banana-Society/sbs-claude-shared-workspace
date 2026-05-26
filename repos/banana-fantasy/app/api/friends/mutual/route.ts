/**
 * GET /api/friends/mutual?wallet=0x...
 *
 * Returns the list of users who are friends with BOTH the caller and the
 * given wallet. Used to surface "X mutual friends" in user cards.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getPrivyUser } from '@/lib/auth';
import { ApiError } from '@/lib/api/errors';
import { getMutualFriends } from '@/lib/friends';

const WALLET_RE = /^0x[a-f0-9]{40}$/i;

export async function GET(req: Request) {
  let user: { userId: string; walletAddress: string | null };
  try {
    user = await getPrivyUser(req);
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!user.walletAddress) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  const targetWallet = new URL(req.url).searchParams.get('wallet') || '';
  if (!WALLET_RE.test(targetWallet)) {
    return NextResponse.json({ error: 'invalid wallet param' }, { status: 400 });
  }

  try {
    const mutual = await getMutualFriends(user.walletAddress, targetWallet);
    return NextResponse.json({ mutual });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
